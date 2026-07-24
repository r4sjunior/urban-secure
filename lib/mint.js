/**
 * lib/mint.js
 * Upload (imagem/JSON → /api/upload) e mint de NFT via UMI (proxy /api/rpc).
 * Reusado pelo registro de uma obra original (pages/index.jsx) e pelo mint das
 * figurinhas.
 *
 * O mint usa METAPLEX CORE. Um asset Core é UMA conta; o NFT Token Metadata
 * equivalente são quatro (mint, ATA, metadata, master edition). O rent cai de
 * ~0.0115 pra ~0.0029 SOL — 4x mais barato, o que multiplica por 4 quantos
 * claims diários a treasury do projeto consegue pagar. Como o claim é
 * dimensionado pra cobrir 3 registros por dia (lib/config.js), essa diferença
 * é o que decide se o faucet atende 58 ou 230 pessoas por dia.
 *
 * O acervo antigo continua sendo Token Metadata e continua funcionando —
 * ver lib/solana/standard.js.
 */

import { confirmSignature, clientRpcUrl } from './solana/confirm';

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

/**
 * Sobe foto ou vídeo pro IPFS.
 * @returns {Promise<{ url: string, mime: string }>} o mime é o DETECTADO pelo
 *   servidor (magic bytes), não o declarado aqui — é ele que decide se o
 *   metadata Metaplex sai como `category: image` ou `video`.
 */
export async function uploadFile(file) {
  const base64 = await fileToBase64(file);
  const res = await fetch('/api/upload', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'media', data: base64, filename: file.name || 'arte.jpg', mime: file.type || 'image/jpeg' }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Upload: ${json.error || res.status}`);
  return { url: json.url, mime: json.mime || file.type || 'image/jpeg' };
}

export async function uploadJson(obj) {
  const res = await fetch('/api/upload', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'json', data: obj }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Upload dados: ${json.error || res.status}`);
  return json.url;
}

/**
 * O Core aceita nomes de até 32 bytes on-chain, igual ao Token Metadata.
 * Nomes como "Urban Art — X — Edição Coletada" estouram isso fácil. Corta
 * sem quebrar caracteres multi-byte (acentos, travessão); o nome completo
 * continua intacto no metadata JSON off-chain, que é o que carteiras e
 * exploradores preferem mostrar.
 */
const MAX_ONCHAIN_NAME_BYTES = 32;
function truncateOnChainName(name) {
  const bytes = new TextEncoder().encode(name);
  if (bytes.length <= MAX_ONCHAIN_NAME_BYTES) return name;
  let cut = bytes.slice(0, MAX_ONCHAIN_NAME_BYTES);
  while (cut.length > 0) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(cut); }
    catch { cut = cut.slice(0, -1); }
  }
  return '';
}

/**
 * Minta um asset Metaplex Core via UMI usando o RPC proxy.
 * O asset vai pra carteira que assina (`wallet`) — ela paga o gás.
 *
 * @param {object} opts
 * @param {object} opts.wallet       objeto do useWallet()
 * @param {string} opts.metadataUri  URI do JSON no IPFS
 * @param {string} opts.name
 * @returns {Promise<string>} endereço do asset criado
 */
export async function mintNft({ wallet, metadataUri, name }) {
  const { createUmi } = await import('@metaplex-foundation/umi-bundle-defaults');
  const { walletAdapterIdentity } = await import('@metaplex-foundation/umi-signer-wallet-adapters');
  const { mplCore, create, fetchAssetV1 } = await import('@metaplex-foundation/mpl-core');
  const { generateSigner, base58 } = await import('@metaplex-foundation/umi');
  const { setComputeUnitPrice } = await import('@metaplex-foundation/mpl-toolbox');

  const rpcUrl = clientRpcUrl();
  const umi = createUmi(rpcUrl).use(walletAdapterIdentity(wallet)).use(mplCore());

  const assetSigner = generateSigner(umi);

  let builder = create(umi, {
    asset: assetSigner,
    name: truncateOnChainName(name),
    uri: metadataUri,
    owner: umi.identity.publicKey,
  });

  // Taxa de prioridade — acelera inclusão no bloco.
  try { builder = builder.prepend(setComputeUnitPrice(umi, { microLamports: 200000 })); } catch {}

  const signatureBytes = await builder.send(umi, { skipPreflight: true, maxRetries: 5 });
  const signature = base58.deserialize(signatureBytes)[0];

  const ok = await confirmSignature({
    rpcUrl,
    signature,
    // Se o polling esgotar, o asset pode ter sido criado mesmo assim (RPC
    // atrasado a reportar o status). Buscar a conta é a resposta definitiva.
    fallback: async () => {
      try { await fetchAssetV1(umi, assetSigner.publicKey); return true; }
      catch { return false; }
    },
  });

  if (!ok) throw new Error('Não foi possível confirmar o mint. Tente novamente.');
  return assetSigner.publicKey.toString();
}
