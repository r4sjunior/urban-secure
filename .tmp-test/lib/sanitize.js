/**
 * lib/sanitize.js
 * Remove caracteres que poderiam ser usados para injeção de HTML/scripts
 * em texto vindo do cliente (nome, descrição, comentário...).
 */
export function sanitize(val, maxLen) {
  if (typeof val !== 'string') return '';
  return val.replace(/[<>"'`\\]/g, '').trim().slice(0, maxLen);
}
