/**
 * lib/social/weekly.js
 * Janela da semana competitiva e apuração do ranking. Funções puras.
 *
 * A semana corre de SEGUNDA 00:00 a DOMINGO 23:59:59 no fuso de Brasília,
 * porque a premiação é "toda segunda-feira" e o usuário raciocina no horário
 * dele, não em UTC. Fazer essa conta em UTC deslocaria o corte em 3 horas:
 * arte registrada domingo às 22h de Brasília cairia na semana seguinte e o
 * usuário veria o ponto sumir sem explicação.
 *
 * Todo timestamp continua sendo epoch ms (UTC) — o fuso entra só na hora de
 * decidir ONDE a semana corta.
 */

/** Offset de Brasília em relação a UTC, em ms. O Brasil não usa mais horário
 *  de verão desde 2019, então o offset é constante — o que dispensa a
 *  aritmética de fuso do Intl e mantém estas funções puras e testáveis. */
const BRT_OFFSET_MS = -3 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/**
 * Início (segunda 00:00 BRT) da semana que contém `ts`, em epoch ms UTC.
 */
export function weekStart(ts = Date.now()) {
  // Desloca pro "relógio de Brasília" pra fazer a conta de dia/hora
  const local = ts + BRT_OFFSET_MS;

  // getUTCDay() sobre o valor deslocado dá o dia da semana em Brasília.
  // Domingo é 0; convertemos pra 6 pra que a semana comece na segunda.
  const dow = new Date(local).getUTCDay();
  const daysSinceMonday = (dow + 6) % 7;

  const midnightLocal = Math.floor(local / DAY_MS) * DAY_MS;
  const mondayLocal = midnightLocal - daysSinceMonday * DAY_MS;

  return mondayLocal - BRT_OFFSET_MS;
}

/** Fim exclusivo da semana que contém `ts`. */
export function weekEnd(ts = Date.now()) {
  return weekStart(ts) + WEEK_MS;
}

/**
 * Identificador da semana no formato ISO "2026-W31".
 * É a chave de idempotência da premiação: o cron confere se já existe payout
 * com este id antes de pagar. Sem isso, um retry da Vercel (que reexecuta
 * cron que dá timeout) pagaria o prêmio duas vezes.
 */
export function weekId(ts = Date.now()) {
  const start = weekStart(ts);

  // Regra ISO-8601: a semana 1 é a que contém a primeira quinta-feira do ano.
  // Equivale a dizer que a quinta-feira DESTA semana define de que ano ela é.
  const thursday = start + 3 * DAY_MS;
  const d = new Date(thursday + BRT_OFFSET_MS);
  const year = d.getUTCFullYear();

  const jan1 = Date.UTC(year, 0, 1) - BRT_OFFSET_MS;
  const firstWeekStart = weekStart(jan1 + 3 * DAY_MS);
  const number = Math.round((start - firstWeekStart) / WEEK_MS) + 1;

  return `${year}-W${String(number).padStart(2, '0')}`;
}

/** Semana anterior à que contém `ts` — o que o cron de segunda premia. */
export function previousWeek(ts = Date.now()) {
  const start = weekStart(ts) - WEEK_MS;
  return { start, end: start + WEEK_MS, id: weekId(start) };
}

export function currentWeek(ts = Date.now()) {
  const start = weekStart(ts);
  return { start, end: start + WEEK_MS, id: weekId(start) };
}

/** Quanto falta pro fim da semana corrente, em ms. Alimenta o contador
 *  regressivo na tela de ranking. */
export function msUntilWeekEnd(ts = Date.now()) {
  return Math.max(0, weekEnd(ts) - ts);
}

/**
 * Apura o ranking a partir das artes registradas.
 *
 * Empate é desempatado por quem chegou lá primeiro: entre dois artistas com
 * 5 artes, ganha quem registrou a 5ª antes. Sem esse critério a ordem
 * dependeria da ordem de iteração do Map, e o pódio poderia mudar entre duas
 * leituras sem que ninguém tivesse registrado nada — inaceitável quando
 * decide quem recebe SOL.
 *
 * @param {Array} arts   registry completo (objetos com artistWallet, timestamp)
 * @param {{start:number,end:number}} window
 * @returns {Array<{ wallet, artsCount, lastArtAt, position }>}
 */
export function rankArtists(arts, window) {
  const byWallet = new Map();

  for (const art of arts || []) {
    const ts = Number(art?.timestamp);
    if (!Number.isFinite(ts) || ts < window.start || ts >= window.end) continue;

    const wallet = art?.artistWallet;
    if (!wallet) continue;

    const entry = byWallet.get(wallet) || { wallet, artsCount: 0, lastArtAt: 0 };
    entry.artsCount += 1;
    entry.lastArtAt = Math.max(entry.lastArtAt, ts);
    byWallet.set(wallet, entry);
  }

  return Array.from(byWallet.values())
    .sort((a, b) => b.artsCount - a.artsCount || a.lastArtAt - b.lastArtAt)
    .map((entry, i) => ({ ...entry, position: i + 1 }));
}
