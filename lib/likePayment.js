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
  ComputeBudgetProgram,
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

  // Blockhash 'finalized' dá mais margem antes de expirar
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');

  // Transação com priority fee + UMA única transferência: pagador → artista
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

  // Confirmação robusta: tenta confirmTransaction, mas se expirar,
  // verifica via polling se a transação já existe on-chain antes de falhar.
  try {
    const confirmation = await connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      'confirmed'
    );
    if (confirmation.value.err) {
      throw new Error('Transação falhou ao confirmar.');
    }
    return signature;
  } catch (err) {
    const msg = String(err?.message || err);
    const expired = msg.includes('block height exceeded') || msg.includes('expired') || msg.includes('Timed out');
    if (!expired) throw err;

    // Pode ter confirmado mesmo assim — aguarda e verifica diretamente
    await new Promise(r => setTimeout(r, 8000));
    for (let i = 0; i < 5; i++) {
      const status = await connection.getSignatureStatus(signature, { searchTransactionHistory: true });
      const s = status?.value;
      if (s && (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized')) {
        if (s.err) throw new Error('Transação falhou ao confirmar.');
        return signature; // confirmou de verdade
      }
      await new Promise(r => setTimeout(r, 3000));
    }
    throw new Error('Não foi possível confirmar o pagamento a tempo. Verifique no Solscan se o like foi processado antes de tentar novamente.');
  }
}
