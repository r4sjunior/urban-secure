/**
 * lib/offerSignature.js
 * Mensagens assinadas pela wallet pra provar autoria de uma proposta de
 * lance (comprador) e de uma resposta a ela (artista dono da obra). Usadas
 * tanto pelo cliente (assina) quanto pela API (verifica) — precisam gerar
 * bytes idênticos nos dois lados.
 */
export function buildProposeOfferMessage({ postId, buyerWallet, tier, timestamp }) {
  return (
    `Urban Secure — Propor Lance\n\n` +
    `Confirmo que estou propondo este lance com minha carteira.\n\n` +
    `Obra: ${postId}\n` +
    `Comprador: ${buyerWallet}\n` +
    `Tier: ${tier}x\n` +
    `Timestamp: ${timestamp}`
  );
}

export function buildRespondOfferMessage({ postId, offerId, artistWallet, decision, timestamp }) {
  return (
    `Urban Secure — Responder Lance\n\n` +
    `Confirmo que estou ${decision === 'accept' ? 'aceitando' : 'recusando'} esta proposta com minha carteira.\n\n` +
    `Obra: ${postId}\n` +
    `Proposta: ${offerId}\n` +
    `Artista: ${artistWallet}\n` +
    `Decisão: ${decision}\n` +
    `Timestamp: ${timestamp}`
  );
}
