/**
 * lib/commentSignature.js
 * Mensagem assinada pela wallet do autor para provar autoria de um comentário
 * em POST /api/comments. Usada tanto pelo cliente (assina) quanto pela API
 * (verifica) — precisa gerar bytes idênticos nos dois lados.
 */
export function buildCommentMessage({ postId, wallet, text, timestamp }) {
  return (
    `Urban Secure — Comentar\n\n` +
    `Confirmo que estou publicando este comentário com minha carteira.\n\n` +
    `Obra: ${postId}\n` +
    `Autor: ${wallet}\n` +
    `Comentário: ${text}\n` +
    `Timestamp: ${timestamp}`
  );
}
