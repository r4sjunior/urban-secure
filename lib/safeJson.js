/**
 * lib/safeJson.js
 * Lê a resposta de um fetch com segurança: se o servidor devolver HTML/texto
 * puro (erro 504/502, timeout da função), não quebra no JSON.parse — devolve
 * uma mensagem tratável em vez de deixar o erro de parse vazar pra UI.
 */
export async function safeJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    if (res.status === 504 || /timeout/i.test(text)) {
      throw new Error('O servidor demorou para responder. Sua transação pode ter sido processada — verifique no Solscan antes de tentar de novo.');
    }
    throw new Error('Resposta inválida do servidor. Tente novamente em instantes.');
  }
}
