/**
 * lib/fetchArts.js
 *
 * Leitura da blockchain Solana — busca NFTs com símbolo 'URBAN'.
 *
 * Estratégia atual (MVP):
 *   fetchAllDigitalAssetWithTokenByOwner → NFTs do wallet conectado
 *
 * Para mapa global (todos os artistas), escale com Helius DAS API:
 *   POST https://mainnet.helius-rpc.com/?api-key=KEY
 *   { "method": "searchAssets", "params": { "grouping": ["symbol","URBAN"] } }
 */

const IPFS_GATEWAYS = [
  (hash) => `https://gateway.pinata.cloud/ipfs/${hash}`,
  (hash) => `https://ipfs.io/ipfs/${hash}`,
  (hash) => `https://cloudflare-ipfs.com/ipfs/${hash}`,
];

function extractIpfsHash(uri) {
  if (!uri) return null;
  const m = uri.match(/(?:ipfs:\/\/|\/ipfs\/)([a-zA-Z0-9]+)/);
  return m ? m[1] : null;
}

/**
 * Tenta múltiplos gateways IPFS em sequência.
 * Retorna o JSON do primeiro que responder.
 */
async function fetchMetadataJson(uri) {
  if (!uri) return null;

  const hash = extractIpfsHash(uri);
  const urls = hash
    ? IPFS_GATEWAYS.map(fn => fn(hash))
    : [uri]; // URI HTTP direta (Pinata, Arweave)

  for (const url of urls) {
    const ctrl    = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (res.ok) return await res.json();
    } catch { /* tenta próximo gateway */ }
    finally { clearTimeout(timeout); }
  }
  return null;
}

function getAttribute(attributes, traitType) {
  return attributes?.find(a => a.trait_type === traitType)?.value;
}

/**
 * fetchAllUrbanArts
 *
 * @param {import('@solana/wallet-adapter-react').WalletContextState} wallet
 * @param {'devnet'|'mainnet-beta'} network
 * @returns {Promise<import('../types/art').UrbanArt[]>}
 */
export async function fetchAllUrbanArts(wallet, network = 'devnet') {
  if (!wallet?.publicKey) return [];

  const { createUmi } =
    await import('@metaplex-foundation/umi-bundle-defaults');
  const { walletAdapterIdentity } =
    await import('@metaplex-foundation/umi-signer-wallet-adapters');
  const { mplTokenMetadata, fetchAllDigitalAssetWithTokenByOwner } =
    await import('@metaplex-foundation/mpl-token-metadata');

  const rpcUrl = network === 'mainnet-beta'
    ? 'https://api.mainnet-beta.solana.com'
    : 'https://api.devnet.solana.com';

  const umi = createUmi(rpcUrl)
    .use(walletAdapterIdentity(wallet))
    .use(mplTokenMetadata());

  let allAssets;
  try {
    allAssets = await fetchAllDigitalAssetWithTokenByOwner(umi, wallet.publicKey);
  } catch (err) {
    console.error('[fetchAllUrbanArts] RPC error:', err);
    return [];
  }

  const urbanAssets = allAssets.filter(a => a.metadata.symbol.trim() === 'URBAN');
  if (!urbanAssets.length) return [];

  const results = await Promise.allSettled(
    urbanAssets.map(async (asset) => {
      const json = await fetchMetadataJson(asset.metadata.uri);
      if (!json) return null;

      const lat = parseFloat(getAttribute(json.attributes, 'Latitude'));
      const lng = parseFloat(getAttribute(json.attributes, 'Longitude'));
      if (isNaN(lat) || isNaN(lng)) return null;

      return {
        id:           asset.publicKey.toString(),
        name:         asset.metadata.name,
        description:  json.description  ?? '',
        lat, lng,
        imageUrl:     json.image        ?? '',
        artistWallet: wallet.publicKey.toBase58(),
        timestamp:    Date.now(),
      };
    })
  );

  return results
    .filter(r => r.status === 'fulfilled' && r.value !== null)
    .map(r => r.value);
}
