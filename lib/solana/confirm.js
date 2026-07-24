/**
 * lib/solana/confirm.js
 * Confirmação de transação por polling HTTP.
 *
 * Existe porque `sendAndConfirm()` da UMI e `confirmTransaction()` do
 * web3.js só sabem esperar via WebSocket, e a Vercel não faz upgrade de WS
 * em API routes — a espera nunca resolve por conta própria. Todo envio no
 * app usa `send()` + este polling.
 *
 * Estava copiado em lib/mint.js, lib/nftTransfer.js, lib/vaultSigner.js e
 * lib/likePayment.js com pequenas divergências de timeout e de tratamento de
 * erro. Centralizar não é só estética: as cópias já tinham começado a
 * divergir, e a próxima correção teria que ser aplicada em quatro lugares
 * com a chance de esquecer um.
 */

const DEFAULT_ATTEMPTS = 20;
const DEFAULT_INTERVAL_MS = 1500;

/**
 * Espera uma assinatura confirmar, consultando getSignatureStatuses.
 *
 * @param {object}   opts
 * @param {string}   opts.rpcUrl     endpoint JSON-RPC (proxy /api/rpc no cliente)
 * @param {string}   opts.signature  assinatura em base58
 * @param {number}  [opts.attempts]
 * @param {number}  [opts.intervalMs]
 * @param {Function} [opts.fallback] checagem alternativa quando o polling
 *   esgota — recebe zero argumentos e devolve `true` se a operação de fato
 *   aconteceu. Serve pros casos em que a transação confirmou mas o status
 *   não apareceu a tempo (RPC atrasado); sem isso o usuário veria um erro
 *   por uma operação que deu certo, e tentaria de novo.
 * @returns {Promise<boolean>} true se confirmou
 * @throws se a transação confirmou COM erro — aí não adianta tentar de novo
 */
export async function confirmSignature({
  rpcUrl,
  signature,
  attempts = DEFAULT_ATTEMPTS,
  intervalMs = DEFAULT_INTERVAL_MS,
  fallback,
}) {
  for (let i = 0; i < attempts; i++) {
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
    } catch {
      // Falha de rede numa volta não é conclusiva — tenta de novo.
    }

    if (status) {
      // Transação incluída no bloco mas revertida. Repetir não muda nada,
      // então falha alto em vez de esperar as voltas restantes.
      if (status.err) throw new Error('A transação falhou ao confirmar.');
      if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') {
        return true;
      }
    }

    await new Promise(r => setTimeout(r, intervalMs));
  }

  if (fallback && await fallback()) return true;
  return false;
}

/** URL do proxy RPC no cliente. Nunca usar no servidor — lá vale o Helius
 *  direto (ver heliusRpcUrl em lib/treasury.js). */
export function clientRpcUrl() {
  return `${window.location.origin}/api/rpc`;
}
