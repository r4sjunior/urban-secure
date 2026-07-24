/**
 * lib/rateLimit.js
 * Limite de requisições por chave (normalmente o IP), em memória.
 *
 * IMPORTANTE — o que isto é e o que não é:
 *
 * Funções serverless não compartilham memória entre instâncias, então este
 * limite vale por instância, não globalmente. Com Fluid Compute a Vercel
 * reusa instâncias entre requisições, o que faz o contador pegar boa parte
 * do tráfego de um mesmo atacante — mas quem distribuir a carga o suficiente
 * pra cair em instâncias diferentes escapa.
 *
 * Ou seja: isto é um redutor de ruído, não uma trava de segurança. A trava
 * real do faucet é o teto diário da treasury (DAILY_TREASURY_BUDGET_SOL),
 * que é decidido sobre estado compartilhado e limita o prejuízo máximo
 * independente de quantas instâncias existam. Este arquivo serve pra que um
 * script ingênuo em loop não gaste o orçamento do dia em dois minutos.
 *
 * Se um dia isso não bastar, o substituto é um contador em storage
 * compartilhado (Upstash Redis via Marketplace) — não uma versão mais
 * elaborada deste Map.
 */

/** chave → array de timestamps das requisições dentro da janela */
const hits = new Map();

// Sem isto o Map cresce pra sempre num processo de vida longa: cada IP novo
// deixa uma entrada que nunca é lida de novo.
const MAX_KEYS = 5000;

function prune(now, windowMs) {
  for (const [key, times] of hits) {
    const live = times.filter(t => now - t < windowMs);
    if (live.length === 0) hits.delete(key);
    else hits.set(key, live);
  }
}

/**
 * @param {string} key
 * @param {number} limit     requisições permitidas na janela
 * @param {number} windowMs
 * @returns {{ ok: boolean, remaining: number, retryAfterMs: number }}
 */
export function rateLimit(key, limit, windowMs) {
  const now = Date.now();

  if (hits.size > MAX_KEYS) prune(now, windowMs);

  const times = (hits.get(key) || []).filter(t => now - t < windowMs);

  if (times.length >= limit) {
    // O mais antigo da janela é o que vai expirar primeiro e liberar a vaga.
    const retryAfterMs = windowMs - (now - times[0]);
    hits.set(key, times);
    return { ok: false, remaining: 0, retryAfterMs };
  }

  times.push(now);
  hits.set(key, times);
  return { ok: true, remaining: limit - times.length, retryAfterMs: 0 };
}

/**
 * IP do cliente atrás do proxy da Vercel.
 *
 * `x-forwarded-for` pode vir como "cliente, proxy1, proxy2" — o primeiro é o
 * cliente. O header é falsificável em geral, mas na Vercel o proxy da
 * plataforma reescreve o valor, então o primeiro elemento é confiável aqui.
 */
export function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff) return xff.split(',')[0].trim();
  if (Array.isArray(xff) && xff.length) return String(xff[0]).trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'desconhecido';
}
