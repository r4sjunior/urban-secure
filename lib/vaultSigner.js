/**
 * lib/vaultSigner.js
 * Vault custodial do marketplace de revenda: uma keypair do servidor guarda
 * o NFT enquanto ele está anunciado pra venda (transferido pelo vendedor no
 * momento do anúncio) e libera pro comprador assim que o pagamento é
 * confirmado on-chain — ou devolve ao vendedor se ele cancelar o anúncio.
 *
 * SERVIDOR APENAS — nunca importar isto de um componente client-side.
 * Requer a env var MARKETPLACE_VAULT_SECRET_KEY (keypair Solana em base58,
 * 64 bytes — o mesmo formato exportado por `solana-keygen` ou pelo Phantom).
 */
import nacl from 'tweetnacl';
import bs58 from 'bs58';

function getSecretKeyBytes() {
  const raw = process.env.MARKETPLACE_VAULT_SECRET_KEY;
  if (!raw) throw new Error('MARKETPLACE_VAULT_SECRET_KEY ausente no ambiente da função.');
  const bytes = bs58.decode(raw.trim());
  if (bytes.length !== 64) throw new Error('MARKETPLACE_VAULT_SECRET_KEY inválida (esperado keypair de 64 bytes em base58).');
  return bytes;
}

function heliusRpcUrl() {
  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) throw new Error('HELIUS_API_KEY ausente no ambiente da função.');
  const network = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet';
  const cluster = network === 'mainnet-beta' ? 'mainnet' : 'devnet';
  return `https://${cluster}.helius-rpc.com/?api-key=${apiKey}`;
}

export function getVaultAddress() {
  const { publicKey } = nacl.sign.keyPair.fromSecretKey(getSecretKeyBytes());
  return bs58.encode(publicKey);
}

/**
 * Confirma, via RPC padrão (não DAS — funciona em devnet e mainnet), que a
 * vault já recebeu a obra antes de aceitar o anúncio.
 *
 * Os dois padrões respondem essa pergunta de formas diferentes: num asset
 * Core o dono é um campo da própria conta, num NFT Token Metadata é preciso
 * achar a token account. Ver lib/solana/standard.js.
 */
export async function verifyVaultHoldsMint(mint) {
  const vaultAddress = getVaultAddress();
  const rpcUrl = heliusRpcUrl();

  const { detectStandard, STANDARD_CORE } = await import('./solana/standard');
  const standard = await detectStandard(rpcUrl, mint);
  if (!standard) return false;

  if (standard === STANDARD_CORE) {
    const { createUmi } = await import('@metaplex-foundation/umi-bundle-defaults');
    const { mplCore, fetchAssetV1 } = await import('@metaplex-foundation/mpl-core');
    const { publicKey } = await import('@metaplex-foundation/umi');

    const umi = createUmi(rpcUrl).use(mplCore());
    try {
      const asset = await fetchAssetV1(umi, publicKey(mint));
      return asset.owner.toString() === vaultAddress;
    } catch {
      return false;
    }
  }

  const r = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getTokenAccountsByOwner',
      params: [vaultAddress, { mint }, { encoding: 'jsonParsed', commitment: 'confirmed' }],
    }),
  });
  const json = await r.json();
  const accounts = json?.result?.value || [];
  return accounts.some(a => {
    const amt = a?.account?.data?.parsed?.info?.tokenAmount;
    return amt && Number(amt.amount) >= 1;
  });
}

/**
 * Transfere um NFT URBAN da vault para `toWallet`, assinado pela keypair do
 * servidor. Usado depois de confirmar uma compra, ou pra devolver a obra
 * quando o vendedor cancela o anúncio.
 */
export async function transferFromVault({ mint, toWallet }) {
  const { createUmi } = await import('@metaplex-foundation/umi-bundle-defaults');
  const { publicKey: toUmiPublicKey, createSignerFromKeypair, keypairIdentity, base58 } = await import('@metaplex-foundation/umi');
  const { setComputeUnitPrice } = await import('@metaplex-foundation/mpl-toolbox');
  const { confirmSignature } = await import('./solana/confirm');
  const { detectStandard, STANDARD_CORE } = await import('./solana/standard');

  const rpcUrl = heliusRpcUrl();
  const standard = await detectStandard(rpcUrl, mint);
  if (!standard) throw new Error('Obra não encontrada on-chain.');

  const isCore = standard === STANDARD_CORE;

  // Cada padrão precisa do seu plugin registrado na UMI.
  const plugin = isCore
    ? (await import('@metaplex-foundation/mpl-core')).mplCore()
    : (await import('@metaplex-foundation/mpl-token-metadata')).mplTokenMetadata();

  const umi = createUmi(rpcUrl).use(plugin);
  const keypair = umi.eddsa.createKeypairFromSecretKey(getSecretKeyBytes());
  umi.use(keypairIdentity(createSignerFromKeypair(umi, keypair)));

  const mintPk = toUmiPublicKey(mint);
  const destPk = toUmiPublicKey(toWallet);

  let builder;
  if (isCore) {
    const { transferV1 } = await import('@metaplex-foundation/mpl-core');
    builder = transferV1(umi, { asset: mintPk, newOwner: destPk });
  } else {
    const { transferV1, fetchDigitalAsset, TokenStandard } = await import('@metaplex-foundation/mpl-token-metadata');
    const asset = await fetchDigitalAsset(umi, mintPk);

    let ts = TokenStandard.NonFungible;
    const onChainTs = asset?.metadata?.tokenStandard;
    if (onChainTs && onChainTs.__option === 'Some') ts = onChainTs.value;

    builder = transferV1(umi, {
      mint: mintPk,
      authority: umi.identity,
      tokenOwner: umi.identity.publicKey,
      destinationOwner: destPk,
      tokenStandard: ts,
    });
  }

  try { builder = builder.prepend(setComputeUnitPrice(umi, { microLamports: 200000 })); } catch {}

  // send() + polling em vez de sendAndConfirm() — evita depender de WebSocket,
  // indisponível em ambiente serverless. Ver lib/solana/confirm.js.
  const signatureBytes = await builder.send(umi, { skipPreflight: true, maxRetries: 5 });
  const signature = base58.deserialize(signatureBytes)[0];

  const ok = await confirmSignature({
    rpcUrl,
    signature,
    // Se a obra já não está mais na vault, a transferência aconteceu — mesmo
    // que o status da assinatura não tenha aparecido a tempo.
    fallback: async () => !(await verifyVaultHoldsMint(mint)),
  });

  if (!ok) throw new Error('Não foi possível confirmar a transferência da vault.');
}
