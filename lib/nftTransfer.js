/**
 * lib/nftTransfer.js
 * Transfere um NFT URBAN da carteira conectada para outro endereço Solana
 * via UMI (proxy /api/rpc). Extraído de TransferModal pra ser reusado
 * também pelo MarketModal (transferência pra vault ao anunciar venda).
 *
 * Usa `builder.send()` + polling manual de assinatura em vez de
 * `sendAndConfirm()` — o confirm() da UMI só espera via WebSocket, que a
 * Vercel não suporta em API routes (upgrade sempre falha), então nunca
 * resolveria sozinho. Mesmo padrão usado em lib/mint.js.
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
  const { publicKey, base58 } = await import('@metaplex-foundation/umi');
  const { setComputeUnitPrice } = await import('@metaplex-foundation/mpl-toolbox');

  const rpcUrl = `${window.location.origin}/api/rpc`;
  const umi = createUmi(rpcUrl)
    .use(walletAdapterIdentity(wallet)).use(mplTokenMetadata());

  const destPk = publicKey(destination.trim());
  const asset = await fetchDigitalAsset(umi, publicKey(mint));

  let ts = TokenStandard.NonFungible;
  const onChainTs = asset?.metadata?.tokenStandard;
  if (onChainTs && onChainTs.__option === 'Some') ts = onChainTs.value;

  // Verifica se o NFT já saiu da carteira (fallback caso o polling de
  // assinatura não encontre nada — a transferência pode ter confirmado mesmo assim)
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

  const signatureBytes = await builder.send(umi, { skipPreflight: true, maxRetries: 5 });
  const signature = base58.deserialize(signatureBytes)[0];

  for (let i = 0; i < 20; i++) {
    let status;
    try {
      const r = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'getSignatureStatuses',
          params: [[signature], { searchTransactionHistory: true }],
        }),
      });
      const json = await r.json();
      status = json?.result?.value?.[0];
    } catch { /* tenta de novo na próxima volta */ }

    if (status) {
      if (status.err) throw new Error('Transação de transferência falhou ao confirmar.');
      if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') {
        return;
      }
    }
    await new Promise(r => setTimeout(r, 1500));
  }

  if (await jaTransferiu()) return;
  throw new Error('A confirmação demorou. Verifique sua carteira antes de tentar de novo.');
}
