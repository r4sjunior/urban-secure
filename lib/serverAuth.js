/**
 * lib/serverAuth.js
 * Autenticação das rotas operacionais (cron e admin).
 *
 * SERVIDOR APENAS. Estas rotas são públicas por natureza — a Vercel invoca o
 * cron pela internet — e disparam pagamentos. O segredo compartilhado é a
 * única coisa entre elas e qualquer pessoa com o URL.
 *
 * Estava só no cron da premiação; virou módulo quando a rota de administração
 * da treasury passou a precisar da mesma proteção. Duas cópias de uma checagem
 * de segurança é como uma delas fica para trás numa correção.
 */

/**
 * Comparação em tempo constante — evita que a diferença de tempo entre um
 * segredo errado no primeiro caractere e no último vaze o valor.
 */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Exige `Authorization: Bearer $CRON_SECRET`. Responde e devolve `true` quando
 * a requisição deve parar — mesmo contrato de `guardServerConfig`.
 *
 * Falha FECHADO: sem `CRON_SECRET` configurado, ninguém passa. O contrário
 * seria transformar o esquecimento de uma env var numa rota de pagamento
 * aberta ao mundo.
 */
export function guardOperatorSecret(req, res, label) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error(`[${label}] CRON_SECRET ausente — rota desativada.`);
    res.status(500).json({ error: 'Rota operacional não configurada.' });
    return true;
  }

  if (!safeEqual(req.headers.authorization || '', `Bearer ${secret}`)) {
    res.status(401).json({ error: 'Não autorizado.' });
    return true;
  }

  return false;
}
