/**
 * lib/nftTransfer.js
 * Transfere um NFT URBAN da carteira conectada para outro endereço Solana
 * via UMI (proxy /api/rpc). Extraído de TransferModal pra ser reusado
 * também pelo MarketModal (transferência pra vault ao anunciar venda).
 */

/**
 * @param {object} wallet - objeto do useWallet()
 * @param {string} mint - endereço do mint do NFT a transferir
 * @param {string} destination - endereço Solana de destino
 */
export async function transferNft({ wallet, mint, destination }) {
  const { createUmi } = await import('@metaplex-foundation/umi-bundle-defaults');
  const { walletAdapterIdentity } = await import('@metaplex-foundation/umi-signer-wallet-adapters');
  const { mplTokenMetadata, transferV1, fetchDigitalAsset, fetchAllDigitalAssetWithTokenByOwner, TokenStandard } = await import('@metaplex-foundation/mpl-token-metadata');
  const { publicKey } = await import('@metaplex-foundation/umi');
  const { setComputeUnitPrice } = await import('@metaplex-foundation/mpl-toolbox');

  const umi = createUmi(`${window.location.origin}/api/rpc`)
    .use(walletAdapterIdentity(wallet)).use(mplTokenMetadata());

  const destPk = publicKey(destination.trim());
  const asset = await fetchDigitalAsset(umi, publicKey(mint));

  let ts = TokenStandard.NonFungible;
  const onChainTs = asset?.metadata?.tokenStandard;
  if (onChainTs && onChainTs.__option === 'Some') ts = onChainTs.value;

  // Verifica se o NFT já saiu da carteira (transferência confirmada)
  async function jaTransferiu() {
    try {
      const restantes = await fetchAllDigitalAssetWithTokenByOwner(umi, umi.identity.publicKey);
      return !restantes.some(a => a.publicKey.toString() === mint);
    } catch { return false; }
  }

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

  try {
    await builder.sendAndConfirm(umi, {
      confirm: { commitment: 'confirmed' },
      send: { skipPreflight: true, maxRetries: 5 },
    });
  } catch (errSend) {
    const m = String(errSend?.message || '');
    if (m.includes('expired') || m.includes('block height')) {
      await new Promise(r => setTimeout(r, 8000));
      const ok = await jaTransferiu();
      if (!ok) throw new Error('A confirmação demorou. Verifique sua carteira antes de tentar de novo.');
    } else {
      throw errSend;
    }
  }
}
