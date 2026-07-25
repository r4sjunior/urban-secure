/**
 * lib/social/welcomeSignature.js
 * Mensagem assinada para receber o SOL de boas-vindas.
 *
 * Como todas as outras autorizações do app, prova posse da carteira sem
 * gerar transação. Aqui ela importa por um motivo específico: sem
 * assinatura, qualquer um dispararia as boas-vindas de uma carteira alheia
 * — e como é benefício de uso único, a vítima perderia o dela para sempre
 * num momento que não escolheu.
 */

export function buildWelcomeMessage({ wallet, timestamp }) {
  return (
    `Urban Secure — Boas-vindas\n\n` +
    `Confirmo o recebimento do SOL para registrar minha primeira arte.\n` +
    `Esta ação é gratuita e acontece uma única vez.\n\n` +
    `Carteira: ${wallet}\n` +
    `Timestamp: ${timestamp}`
  );
}
