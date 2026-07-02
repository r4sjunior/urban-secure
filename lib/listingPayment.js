/**
 * lib/listingPayment.js
 * Pagamento de uma compra no marketplace de revenda — 100% pro vendedor,
 * no valor anunciado. Mesma mecânica de lib/likePayment.js e
 * lib/collectPayment.js (transferência única via SystemProgram.transfer).
 */

import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  ComputeBudgetProgram,
} from '@solana/web3.js';

const LAMPORTS_PER_SOL = 1_000_000_000;

/**
 * Envia o pagamento de uma compra (100% ao vendedor) e retorna a assinatura confirmada.
 *
 * @param {object} wallet - objeto do useWallet() (precisa publicKey + sendTransaction)
 * @param {string} sellerWallet - endereço da wallet do vendedor
 * @param {number} priceSol - preço anunciado, em SOL
 */
export async function payForListing(wallet, sellerWallet, priceSol) {
  if (!wallet?.publicKey || !wallet?.sendTransaction) {
    throw new Error('Carteira não conectada.');
  }

  let sellerPk;
  try {
    sellerPk = new PublicKey(sellerWallet);
  } catch {
    throw new Error('Endereço do vendedor inválido.');
  }

  if (sellerPk.equals(wallet.publicKey)) {
    throw new Error('Você não pode comprar seu próprio anúncio.');
  }

  const total = Math.round(priceSol * LAMPORTS_PER_SOL);

  const rpcUrl = `${window.location.origin}/api/rpc`;
  const connection = new Connection(rpcUrl, { commitment: 'confirmed', disableRetryOnRateLimit: true });

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');

  const tx = new Transaction({
    feePayer: wallet.publicKey,
    blockhash,
    lastValidBlockHeight,
  }).add(
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 200000 }),
    SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: sellerPk,
      lamports: total,
    })
  );

  const signature = await wallet.sendTransaction(tx, connection, {
    skipPreflight: true,
    maxRetries: 5,
  });

  for (let i = 0; i < 20; i++) {
    const status = await connection.getSignatureStatus(signature, { searchTransactionHistory: true });
    const s = status?.value;
    if (s) {
      if (s.err) throw new Error('Transação falhou ao confirmar.');
      if (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized') {
        return signature;
      }
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error('Não foi possível confirmar o pagamento a tempo. Verifique no Solscan se a compra foi processada antes de tentar novamente.');
}
