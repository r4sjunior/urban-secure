/**
 * lib/collectPayment.js
 * Pagamento do "coletar" — 100% para a carteira do artista (autor do NFT).
 * Mesma mecânica de lib/likePayment.js (transferência única via
 * SystemProgram.transfer), só que com o preço de coleta.
 */

import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  ComputeBudgetProgram,
} from '@solana/web3.js';

const LAMPORTS_PER_SOL = 1_000_000_000;

export function getCollectPriceLamports() {
  const sol = parseFloat(process.env.NEXT_PUBLIC_COLLECT_PRICE_SOL || '0.0012');
  return Math.round(sol * LAMPORTS_PER_SOL);
}

export function getCollectPriceSol() {
  return getCollectPriceLamports() / LAMPORTS_PER_SOL;
}

/**
 * Envia o pagamento da coleta (100% ao artista) e retorna a assinatura confirmada.
 *
 * @param {object} wallet - objeto do useWallet() (precisa publicKey + sendTransaction)
 * @param {string} artistWallet - endereço da wallet do artista que mintou o NFT original
 */
export async function payForCollect(wallet, artistWallet) {
  if (!wallet?.publicKey || !wallet?.sendTransaction) {
    throw new Error('Carteira não conectada.');
  }

  let artistPk;
  try {
    artistPk = new PublicKey(artistWallet);
  } catch {
    throw new Error('Endereço do artista inválido.');
  }

  // O artista não pode coletar a própria obra
  if (artistPk.equals(wallet.publicKey)) {
    throw new Error('O artista não pode coletar a própria obra.');
  }

  const total = getCollectPriceLamports();

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
      toPubkey: artistPk,
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
  throw new Error('Não foi possível confirmar o pagamento a tempo. Verifique no Solscan se a coleta foi processada antes de tentar novamente.');
}
