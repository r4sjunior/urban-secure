/**
 * lib/stickers/tradeSignature.js
 * Mensagens assinadas das ações de troca. Cliente assina, API verifica —
 * precisam gerar bytes idênticos nos dois lados.
 *
 * Cada ação tem sua mensagem, com as duas figurinhas dentro. Uma assinatura
 * genérica de "troca" permitiria que quem a interceptasse a aplicasse a
 * qualquer par — e como a troca move NFTs de verdade, isso seria roubo.
 */

export const TRADE_TTL_MS = 48 * 60 * 60 * 1000;

export function buildProposeTradeMessage({ fromWallet, toWallet, offeredMint, requestedMint, timestamp }) {
  return (
    `Urban Secure — Propor Troca\n\n` +
    `Confirmo que estou propondo esta troca de figurinhas.\n` +
    `Se aceita, minha figurinha vai para a outra carteira.\n\n` +
    `De: ${fromWallet}\n` +
    `Para: ${toWallet}\n` +
    `Ofereço: ${offeredMint}\n` +
    `Quero: ${requestedMint}\n` +
    `Timestamp: ${timestamp}`
  );
}

export function buildRespondTradeMessage({ tradeId, wallet, decision, timestamp }) {
  const verbo = decision === 'accept' ? 'aceitando' : decision === 'cancel' ? 'cancelando' : 'recusando';
  return (
    `Urban Secure — Responder Troca\n\n` +
    `Confirmo que estou ${verbo} esta proposta de troca.\n\n` +
    `Proposta: ${tradeId}\n` +
    `Carteira: ${wallet}\n` +
    `Decisão: ${decision}\n` +
    `Timestamp: ${timestamp}`
  );
}
