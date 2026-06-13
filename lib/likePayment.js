/**
 * lib/likePayment.js
 * Monta e envia a transação de pagamento do "like pago".
 * Split: 80% artista / 20% Urban Secure, via SystemProgram.transfer simples
 * (duas instruções na mesma transação, uma assinatura só).
 */

import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';

const LAMPORTS_PER_SOL = 1_000_000_000;

export function getLikePriceLamports() {
  const sol = parseFloat(process.env.NEXT_PUBLIC_LIKE_PRICE_SOL || '0.0003');
  return Math.round(sol * LAMPORTS_PER_SOL);
}

export function getLikePriceSol() {
  return getLikePriceLamports() / LAMPORTS_PER_SOL;
}

/**
 * Envia o pagamento do like e retorna a assinatura da transação confirmada.
 *
 * @param {object} wallet - objeto do useWallet() (precisa publicKey + sendTransaction)
 * @param {string} artistWallet - endereço da wallet do artista (recebe 80%)
 */
export async function payForLike(wallet, artistWallet) {
  if (!wallet?.publicKey || !wallet?.sendTransaction) {
    throw new Error('Carteira não conectada.');
  }

  const feeWallet = process.env.NEXT_PUBLIC_URBAN_FEE_WALLET;
  if (!feeWallet) throw new Error('Fee wallet não configurada.');

  let artistPk, feePk;
  try {
    artistPk = new PublicKey(artistWallet);
    feePk = new PublicKey(feeWallet);
  } catch {
    throw new Error('Endereço de wallet inválido.');
  }

  if (artistPk.equals(wallet.publicKey)) {
    throw new Error('O artista não pode curtir o próprio post.');
  }

  const total = getLikePriceLamports();
  const artistShare = Math.floor(total * 0.8);
  const feeShare = total - artistShare;

  const rpcUrl = `${window.location.origin}/api/rpc`;
  const connection = new Connection(rpcUrl, 'confirmed');

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');

  const tx = new Transaction({
    feePayer: wallet.publicKey,
    blockhash,
    lastValidBlockHeight,
  }).add(
    SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: artistPk,
      lamports: artistShare,
    }),
    SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: feePk,
      lamports: feeShare,
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
