/**
 * lib/fetchArts.js
 *
 * Busca GLOBAL de artes urbanas via Helius DAS API.
 * Retorna todos os NFTs com símbolo 'URBAN' de QUALQUER carteira.
 */

const IPFS_GATEWAYS = [
  (h) => `https://gateway.pinata.cloud/ipfs/${h}`,
  (h) => `https://ipfs.io/ipfs/${h}`,
  (h) => `https://cloudflare-ipfs.com/ipfs/${h}`,
];

function extractIpfsHash(uri) {
  if (!uri) return null;
  const m = uri.match(/(?:ipfs:\/\/|\/ipfs\/)([a-zA-Z0-9]+)/);
  return m ? m[1] : null;
}

async function fetchMetadataJson(uri) {
  if (!uri) return null;
  const hash = extractIpfsHash(uri);
  const urls = hash ? IPFS_GATEWAYS.map(fn => fn(hash)) : [uri];

  for (const url of urls) {
    const ctrl    = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (res.ok) return await res.json();
    } catch { /* tenta próximo */ }
    finally { clearTimeout(timeout); }
  }
  return null;
}

function getAttribute(attributes, traitType) {
  return attributes?.find(a => a.trait_type === traitType)?.value;
}

/**
 * fetchAllUrbanArts — busca global via Helius DAS API
 * Não depende de wallet conectado — mostra artes de TODOS os usuários.
 *
 * @param {string} network - 'devnet' | 'mainnet-beta'
 * @returns {Promise<import('../types/art').UrbanArt[]>}
 */
export async function fetchAllUrbanArts(wallet, network = 'devnet') {
  const apiKey  = process.env.NEXT_PUBLIC_HELIUS_API_KEY;
  const cluster = network === 'mainnet-beta' ? 'mainnet' : 'devnet';
  const url     = `https://${cluster}.helius-rpc.com/?api-key=${apiKey}`;

  let page  = 1;
  let assets = [];

  // Helius pagina de 1000 em 1000 — busca todas as páginas
  while (true) {
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id:      'urban-secure',
        method:  'searchAssets',
        params:  {
          tokenType: 'nonFungible',
          // Filtra por símbolo URBAN
          content: { metadata: { symbol: 'URBAN' } },
          page,
          limit: 1000,
        },
      }),
    });

    if (!res.ok) break;
    const data = await res.json();
    const items = data?.result?.items ?? [];
    assets = [...assets, ...items];

    // Para quando não há mais páginas
    if (items.length < 1000) break;
    page++;
  }

  if (!assets.length) return [];

  // Para cada NFT, busca metadados off-chain e extrai coordenadas
  const results = await Promise.allSettled(
    assets.map(async (asset) => {
      const uri = asset?.content?.json_uri;
      if (!uri) return null;

      // Tenta usar os atributos já indexados pelo Helius (mais rápido)
      const heliusAttrs = asset?.content?.metadata?.attributes;
      let lat, lng, imageUrl, description;

      if (heliusAttrs?.length) {
        lat         = parseFloat(getAttribute(heliusAttrs, 'Latitude'));
        lng         = parseFloat(getAttribute(heliusAttrs, 'Longitude'));
        imageUrl    = asset?.content?.links?.image ?? '';
        description = asset?.content?.metadata?.description ?? '';
      }

      // Se Helius não tiver os atributos, busca o JSON no IPFS
      if (isNaN(lat) || isNaN(lng)) {
        const json = await fetchMetadataJson(uri);
        if (!json) return null;
        lat         = parseFloat(getAttribute(json.attributes, 'Latitude'));
        lng         = parseFloat(getAttribute(json.attributes, 'Longitude'));
        imageUrl    = json.image        ?? '';
        description = json.description  ?? '';
      }

      if (isNaN(lat) || isNaN(lng)) return null;

      const owner = asset?.ownership?.owner ?? '';

      return {
        id:           asset.id,
        name:         asset?.content?.metadata?.name ?? 'Urban Art',
        description,
        lat, lng,
        imageUrl,
        artistWallet: owner,
        timestamp:    Date.now(),
      };
    })
  );

  return results
    .filter(r => r.status === 'fulfilled' && r.value !== null)
    .map(r => r.value);
}
