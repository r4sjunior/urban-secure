/**
 * lib/nftTransfer.js
 * Transfere uma arte URBAN da carteira conectada para outro endereço.
 * Reusado pelo TransferModal e pelo MarketModal (envio pra vault ao anunciar).
 *
 * Roteia entre os DOIS padrões: as artes novas são Metaplex Core, o acervo
 * anterior é Token Metadata. Um usuário que registrou obras antes da migração
 * precisa continuar podendo transferi-las e vendê-las — quebrar isso apagaria
 * na prática o histórico dele. Ver lib/solana/standard.js.
 */

import { confirmSignature, clientRpcUrl } from './solana/confirm';
import { detectStandard, STANDARD_CORE } from './solana/standard';

/**
 * @param {object} opts
 * @param {object} opts.wallet       objeto do useWallet()
 * @param {string} opts.mint         endereço do asset/mint a transferir
 * @param {string} opts.destination  endereço Solana de destino
 */
export async function transferNft({ wallet, mint, destination }) {
  const rpcUrl = clientRpcUrl();
  const dest = destination.trim();

  const standard = await detectStandard(rpcUrl, mint);
  if (!standard) throw new Error('Arte não encontrada on-chain.');

  return standard === STANDARD_CORE
    ? transferCore({ wallet, mint, destination: dest, rpcUrl })
    : transferTokenMetadata({ wallet, mint, destination: dest, rpcUrl });
}

/** Metaplex Core — uma conta, uma instrução. */
async function transferCore({ wallet, mint, destination, rpcUrl }) {
  const { createUmi } = await import('@metaplex-foundation/umi-bundle-defaults');
  const { walletAdapterIdentity } = await import('@metaplex-foundation/umi-signer-wallet-adapters');
  const { mplCore, transferV1, fetchAssetV1 } = await import('@metaplex-foundation/mpl-core');
  const { publicKey, base58 } = await import('@metaplex-foundation/umi');
  const { setComputeUnitPrice } = await import('@metaplex-foundation/mpl-toolbox');

  const umi = createUmi(rpcUrl).use(walletAdapterIdentity(wallet)).use(mplCore());
  const assetPk = publicKey(mint);

  let builder = transferV1(umi, {
    asset: assetPk,
    newOwner: publicKey(destination),
    // Core pede a collection quando o asset pertence a uma; as artes do app
    // são avulsas, então fica ausente.
  });
  try { builder = builder.prepend(setComputeUnitPrice(umi, { microLamports: 200000 })); } catch {}

  const signatureBytes = await builder.send(umi, { skipPreflight: true, maxRetries: 5 });
  const signature = base58.deserialize(signatureBytes)[0];

  const ok = await confirmSignature({
    rpcUrl,
    signature,
    // Fallback: relê o asset e vê se o dono já mudou. Resolve o caso do RPC
    // atrasado a reportar o status de uma transação que de fato passou.
    fallback: async () => {
      try {
        const asset = await fetchAssetV1(umi, assetPk);
        return asset.owner.toString() === destination;
      } catch { return false; }
    },
  });

  if (!ok) throw new Error('A confirmação demorou. Verifique sua carteira antes de tentar de novo.');
}

/** Token Metadata — acervo anterior à migração. */
async function transferTokenMetadata({ wallet, mint, destination, rpcUrl }) {
  const { createUmi } = await import('@metaplex-foundation/umi-bundle-defaults');
  const { walletAdapterIdentity } = await import('@metaplex-foundation/umi-signer-wallet-adapters');
  const {
    mplTokenMetadata, transferV1, fetchDigitalAsset,
    fetchAllDigitalAssetWithTokenByOwner, TokenStandard,
  } = await import('@metaplex-foundation/mpl-token-metadata');
  const { publicKey, base58 } = await import('@metaplex-foundation/umi');
  const { setComputeUnitPrice } = await import('@metaplex-foundation/mpl-toolbox');

  const umi = createUmi(rpcUrl).use(walletAdapterIdentity(wallet)).use(mplTokenMetadata());

  const destPk = publicKey(destination);
  const asset = await fetchDigitalAsset(umi, publicKey(mint));

  let ts = TokenStandard.NonFungible;
  const onChainTs = asset?.metadata?.tokenStandard;
  if (onChainTs && onChainTs.__option === 'Some') ts = onChainTs.value;

  const blockhash = await umi.rpc.getLatestBlockhash({ commitment: 'finalized' });

  let builder = transferV1(umi, {
    mint: publicKey(mint),
    authority: umi.identity,
    tokenOwner: umi.identity.publicKey,
    destinationOwner: destPk,
    tokenStandard: ts,
  });
  try { builder = builder.prepend(setComputeUnitPrice(umi, { microLamports: 200000 })); } catch {}
  builder = builder.setBlockhash(blockhash);

  const signatureBytes = await builder.send(umi, { skipPreflight: true, maxRetries: 5 });
  const signature = base58.deserialize(signatureBytes)[0];

  const ok = await confirmSignature({
    rpcUrl,
    signature,
    fallback: async () => {
      try {
        const restantes = await fetchAllDigitalAssetWithTokenByOwner(umi, umi.identity.publicKey);
        return !restantes.some(a => a.publicKey.toString() === mint);
      } catch { return false; }
    },
  });

  if (!ok) throw new Error('A confirmação demorou. Verifique sua carteira antes de tentar de novo.');
}
