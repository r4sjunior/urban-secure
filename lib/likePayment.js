/**
 * lib/likePayment.js
 * Pagamento do "like" — 100% para a carteira do artista (autor do NFT).
 * Transferência única via SystemProgram.transfer (uma assinatura).
 */

import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';

const LAMPORTS_PER_SOL = 1_000_000_000;

export function getLikePriceLamports() {
  const sol = parseFloat(process.env.NEXT_PUBLIC_LIKE_PRICE_SOL || '0.0028');
  return Math.round(sol * LAMPORTS_PER_SOL);
}

export function getLikePriceSol() {
  return getLikePriceLamports() / LAMPORTS_PER_SOL;
}

/**
 * Envia o pagamento do like (100% ao artista) e retorna a assinatura confirmada.
 *
 * @param {object} wallet - objeto do useWallet() (precisa publicKey + sendTransaction)
 * @param {string} artistWallet - endereço da wallet do artista que mintou o NFT
 */
export async function payForLike(wallet, artistWallet) {
  if (!wallet?.publicKey || !wallet?.sendTransaction) {
    throw new Error('Carteira não conectada.');
  }

  // Valida o endereço do artista (autor do NFT)
  let artistPk;
  try {
    artistPk = new PublicKey(artistWallet);
  } catch {
    throw new Error('Endereço do artista inválido.');
  }

  // O autor não pode curtir/pagar o próprio post
  if (artistPk.equals(wallet.publicKey)) {
    throw new Error('O artista não pode curtir o próprio post.');
  }

  // Valor total do like — vai INTEGRALMENTE para o artista
  const total = getLikePriceLamports();

  const rpcUrl = `${window.location.origin}/api/rpc`;
  const connection = new Connection(rpcUrl, 'confirmed');

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');

  // Transação com UMA única transferência: pagador → artista
  const tx = new Transaction({
    feePayer: wallet.publicKey,
    blockhash,
    lastValidBlockHeight,
  }).add(
    SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: artistPk,
      lamports: total,
    })
  );

  const signature = await wallet.sendTransaction(tx, connection, {
    skipPreflight: false,
    maxRetries: 3,
  });

  const confirmation = await connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    'confirmed'
  );

  if (confirmation.value.err) {
    throw new Error('Transação falhou ao confirmar.');
  }

  return signature;
}
