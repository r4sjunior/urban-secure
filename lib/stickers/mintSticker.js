/**
 * lib/stickers/mintSticker.js
 * Minta uma figurinha (asset Metaplex Core) na carteira do usuário.
 *
 * SERVIDOR APENAS. Quem paga e assina é a treasury do projeto — o usuário
 * não assina nada e não gasta nada ao abrir um pacote. Isso é deliberado:
 * pedir assinatura e gás pra receber um prêmio transformaria a recompensa
 * num custo, e o pacote deixaria de ser recompensa.
 *
 * A figurinha usa `symbol: 'URBANCARD'`, não 'URBAN'. As duas coisas são
 * assets do mesmo app, mas /api/arts monta o mapa filtrando por 'URBAN' — um
 * símbolo compartilhado faria figurinhas tentarem virar pinos no mapa. Elas
 * não têm coordenadas, então cairiam fora de qualquer forma, mas depender
 * disso seria contar com um acidente feliz.
 */

import { heliusRpcUrl } from '../treasury';
import { rarityByKey } from './rarity';

const PINATA_JSON_URL = 'https://api.pinata.cloud/pinning/pinJSONToIPFS';

/**
 * Sobe o metadata da figurinha pro IPFS.
 * Vai direto ao Pinata em vez de passar por /api/upload porque isto roda no
 * servidor — atravessar a própria API HTTP seria um salto de rede a troco de
 * nada, e /api/upload valida `symbol === 'URBAN'`, que não é o caso aqui.
 */
async function uploadStickerMetadata(jwt, metadata) {
  const r = await fetch(PINATA_JSON_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ pinataContent: metadata }),
  });
  if (!r.ok) {
    console.error('[mintSticker] pinata', r.status, (await r.text()).slice(0, 200));
    throw new Error('Falha ao gravar os dados da figurinha.');
  }
  const { IpfsHash } = await r.json();
  return `https://gateway.pinata.cloud/ipfs/${IpfsHash}`;
}

export function buildStickerMetadata({ art, rarity, albumNumber, network }) {
  const r = rarityByKey(rarity);

  return {
    name: `Figurinha #${albumNumber} — ${art.artistName || 'Anônimo'}`,
    symbol: 'URBANCARD',
    description:
      `Figurinha colecionável do Urban Secure.\n\n` +
      `Estampa a obra "${art.name}", registrada por ${art.artistName || 'Anônimo'}.\n` +
      `Raridade: ${r.label}.`,
    image: art.imageUrl,
    attributes: [
      // O crédito ao artista é o atributo mais importante do conjunto: é o
      // que faz a obra circular carregando o nome de quem a registrou, que é
      // o incentivo do app inteiro. Vai on-chain, não só na UI.
      { trait_type: 'Artista',   value: art.artistName || 'Anônimo' },
      { trait_type: 'Carteira do artista', value: art.artistWallet || '' },
      { trait_type: 'Obra original', value: art.id },
      { trait_type: 'Raridade',  value: r.label },
      { trait_type: 'Número',    value: String(albumNumber) },
      { trait_type: 'Tipo',      value: 'Figurinha' },
      { trait_type: 'Rede',      value: network || 'devnet' },
    ],
    properties: {
      category: 'image',
      files: [{ uri: art.imageUrl, type: 'image/jpeg' }],
      // Royalties creditados ao artista original, não ao projeto.
      creators: art.artistWallet ? [{ address: art.artistWallet, share: 100 }] : [],
    },
  };
}

/** Core aceita 32 bytes no nome on-chain. Mesma regra de lib/mint.js. */
function truncateOnChainName(name) {
  const bytes = new TextEncoder().encode(name);
  if (bytes.length <= 32) return name;
  let cut = bytes.slice(0, 32);
  while (cut.length > 0) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(cut); }
    catch { cut = cut.slice(0, -1); }
  }
  return '';
}

/**
 * Minta a figurinha na carteira do usuário, paga pela treasury.
 *
 * @returns {Promise<{ mint: string, signature: string, uri: string }>}
 */
export async function mintSticker({ jwt, toWallet, art, rarity, albumNumber }) {
  const network = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet';
  const rpcUrl = heliusRpcUrl();

  const metadata = buildStickerMetadata({ art, rarity, albumNumber, network });
  const uri = await uploadStickerMetadata(jwt, metadata);

  const { createUmi } = await import('@metaplex-foundation/umi-bundle-defaults');
  const { mplCore, create, fetchAssetV1 } = await import('@metaplex-foundation/mpl-core');
  const {
    generateSigner, createSignerFromKeypair, keypairIdentity, publicKey, base58,
  } = await import('@metaplex-foundation/umi');
  const { setComputeUnitPrice } = await import('@metaplex-foundation/mpl-toolbox');
  const { confirmSignature } = await import('../solana/confirm');
  const bs58 = (await import('bs58')).default;

  const secret = process.env.TREASURY_SECRET_KEY;
  if (!secret) throw new Error('TREASURY_SECRET_KEY ausente no ambiente da função.');

  const umi = createUmi(rpcUrl).use(mplCore());
  const keypair = umi.eddsa.createKeypairFromSecretKey(bs58.decode(secret.trim()));
  umi.use(keypairIdentity(createSignerFromKeypair(umi, keypair)));

  const assetSigner = generateSigner(umi);

  let builder = create(umi, {
    asset: assetSigner,
    name: truncateOnChainName(metadata.name),
    uri,
    // A figurinha nasce direto na carteira do usuário. Mintar na treasury e
    // transferir depois custaria duas transações e deixaria uma janela em
    // que a figurinha existe mas não é de ninguém.
    owner: publicKey(toWallet),
  });
  try { builder = builder.prepend(setComputeUnitPrice(umi, { microLamports: 200000 })); } catch {}

  const signatureBytes = await builder.send(umi, { skipPreflight: true, maxRetries: 5 });
  const signature = base58.deserialize(signatureBytes)[0];

  const ok = await confirmSignature({
    rpcUrl,
    signature,
    fallback: async () => {
      try { await fetchAssetV1(umi, assetSigner.publicKey); return true; }
      catch { return false; }
    },
  });

  if (!ok) throw new Error('Não foi possível confirmar o mint da figurinha.');

  return { mint: assetSigner.publicKey.toString(), signature, uri };
}
