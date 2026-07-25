/**
 * lib/anchor/onchainClaim.js
 * Claim diário pelo programa `urban_social` — leitura e execução.
 *
 * O QUE MUDA EM RELAÇÃO AO CLAIM ANTIGO
 *
 * Antes: o usuário assinava uma mensagem de graça e o SERVIDOR transferia o
 * SOL da keypair da treasury, gravando o streak num JSON no Pinata.
 * Agora: o usuário assina uma TRANSAÇÃO e o programa move o SOL de um PDA,
 * gravando o streak numa conta que só ele consegue escrever.
 *
 * Três consequências práticas que a UI precisa levar em conta:
 *
 *   1. O usuário paga a taxa de rede (~0.000005 SOL) e, no primeiro resgate,
 *      o rent da conta de estado (~0.0013 SOL). Não dá pra o servidor cobrir
 *      isso: o programa declara `payer = user`. Quem chega zerado precisa
 *      passar antes pelo claim de boas-vindas, que continua off-chain
 *      justamente por isso.
 *
 *   2. Não existe mais rollback manual. A transação é atômica: ou o SOL sai e
 *      o streak sobe, ou nada acontece. Toda a dança de reserva prévia do
 *      endpoint antigo deixa de ser necessária.
 *
 *   3. A trava "precisa ter registrado uma arte" NÃO existe no programa. Ela
 *      era verificada pelo servidor, e o servidor não participa mais desta
 *      transação. O que limita o abuso agora é o teto diário, aplicado
 *      on-chain. Ver ARCHITECTURE.md § Segurança.
 */

import { Connection, Transaction, ComputeBudgetProgram } from '@solana/web3.js';
import { claimDailyIx, claimPda, decodeClaimState, parseProgramError } from './urbanProgram';
import { fetchAccount } from './rpc';
import { confirmSignature, clientRpcUrl } from '../solana/confirm';

/**
 * Converte a conta on-chain para o shape que `lib/social/claim.js` já entende.
 *
 * Isto é o que permite migrar sem reescrever a regra: `evaluateClaim` implementa
 * exatamente o mesmo cooldown de 20h, a mesma graça de 48h e o mesmo ciclo de 7
 * que o Rust — então a UI continua usando a função pura de sempre, só que
 * alimentada pela chain. A única tradução necessária é a unidade: a Solana
 * trabalha em segundos, o app em milissegundos.
 */
export function toClaimState(account, wallet) {
  if (!account) {
    return {
      wallet,
      lastClaimAt: 0,
      currentStreak: 0,
      longestStreak: 0,
      completedCycles: 0,
      totalClaims: 0,
      totalLamportsClaimed: 0,
      lastSignature: '',
      onChain: false,
    };
  }
  return {
    wallet: account.wallet,
    lastClaimAt: account.lastClaimAt * 1000,
    currentStreak: account.currentStreak,
    longestStreak: account.longestStreak,
    completedCycles: account.completedCycles,
    totalClaims: account.totalClaims,
    totalLamportsClaimed: account.totalClaimed,
    lastSignature: '',
    onChain: true,
  };
}

/**
 * Lê o estado de claim direto da chain.
 *
 * Roda nos dois lados: o GET de /api/claim chama com a URL do Helius, o
 * cliente com o proxy `/api/rpc`.
 *
 * @param {string} rpcUrl endpoint JSON-RPC
 * @param {string} wallet endereço base58
 * @returns {Promise<object>} estado no shape de lib/social/claim.js
 */
export async function readClaimState(rpcUrl, wallet) {
  const account = await fetchAccount(rpcUrl, claimPda(wallet));
  // Conta ausente é o estado normal de quem nunca resgatou — não é falha.
  if (!account) return toClaimState(null, wallet);
  return toClaimState(decodeClaimState(account.data), wallet);
}

/**
 * Monta, assina e envia o `claim_daily`.
 *
 * @param {object} wallet objeto do useWallet() — precisa de publicKey e sendTransaction
 * @returns {Promise<{ signature: string }>}
 * @throws {Error} com mensagem já traduzida para o usuário
 */
export async function sendClaimDaily(wallet) {
  if (!wallet?.publicKey || !wallet?.sendTransaction) {
    throw new Error('Conecte sua carteira.');
  }

  const rpcUrl = clientRpcUrl();
  const connection = new Connection(rpcUrl, {
    commitment: 'confirmed',
    disableRetryOnRateLimit: true,
  });

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');

  const tx = new Transaction({
    feePayer: wallet.publicKey,
    blockhash,
    lastValidBlockHeight,
  }).add(
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 200000 }),
    claimDailyIx({ user: wallet.publicKey })
  );

  let signature;
  try {
    // `skipPreflight: false` aqui, ao contrário do resto do app: a simulação é
    // o que transforma "cooldown ainda não venceu" num erro imediato e
    // legível, em vez de uma transação que gasta taxa para falhar on-chain.
    signature = await wallet.sendTransaction(tx, connection, {
      skipPreflight: false,
      maxRetries: 5,
    });
  } catch (err) {
    throw new Error(parseProgramError(err) || 'Não foi possível enviar o resgate.');
  }

  const ok = await confirmSignature({ rpcUrl, signature });
  if (!ok) {
    // Não é erro de verdade: a transação pode confirmar depois. Quem chama
    // relê o estado da chain para decidir o que mostrar.
    const err = new Error('A rede demorou a confirmar. Confira seu streak em instantes.');
    err.signature = signature;
    err.pending = true;
    throw err;
  }

  return { signature };
}
