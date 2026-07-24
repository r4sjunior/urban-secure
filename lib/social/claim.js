/**
 * lib/social/claim.js
 * Regra do claim diário e do streak. Funções puras — recebem o estado e o
 * instante, devolvem a decisão ou o próximo estado. Nenhum I/O.
 *
 * Toda a lógica de "pode claimar?", "quanto vale?" e "o streak sobreviveu?"
 * mora aqui de propósito. É a parte do sistema com mais casos de borda
 * (virada de dia, cooldown vencido mas dentro da graça, fechamento de ciclo)
 * e a que mais dói errar — um bug aqui ou paga duas vezes ou zera o streak
 * de quem não fez nada de errado. Sendo pura, dá pra testar cada caso sem
 * subir servidor, sem Pinata e sem RPC.
 *
 * O endpoint (pages/api/claim.js) cuida do I/O e das travas anti-abuso;
 * este arquivo cuida só de "o que a regra diz".
 */

import {
  CLAIM_COOLDOWN_MS,
  STREAK_GRACE_MS,
  STREAK_TARGET,
  claimAmountLamports,
} from '../config';

/** Estado de quem nunca claimou. Devolvido em vez de null pra que o resto do
 *  código nunca precise checar ausência. */
export function emptyClaimState(wallet) {
  return {
    wallet,
    lastClaimAt: 0,
    currentStreak: 0,
    longestStreak: 0,
    completedCycles: 0,
    totalClaims: 0,
    totalLamportsClaimed: 0,
    lastSignature: '',
  };
}

/**
 * Streak que vale AGORA, já considerando expiração.
 *
 * O campo `currentStreak` guardado é o streak no momento do último claim —
 * ele não sabe que o tempo passou. Quem passou de STREAK_GRACE_MS sem
 * claimar perdeu, mesmo que o número gravado diga outra coisa. Toda leitura
 * de streak no app precisa passar por aqui, senão a UI mostra um streak de
 * 6 dias que na verdade já morreu.
 */
export function effectiveStreak(state, now = Date.now()) {
  const last = state?.lastClaimAt || 0;
  if (!last) return 0;
  if (now - last > STREAK_GRACE_MS) return 0;
  return state.currentStreak || 0;
}

/**
 * Avalia a situação do claim sem alterar nada.
 * Alimenta tanto o GET /api/claim quanto a UI do botão.
 *
 * @returns {{
 *   canClaim: boolean,
 *   currentStreak: number,      streak válido agora
 *   nextStreak: number,         streak que resultaria de claimar agora
 *   nextClaimAt: number,        quando o cooldown libera (epoch ms)
 *   msUntilNext: number,        quanto falta pro cooldown liberar
 *   streakExpiresAt: number,    quando o streak morre se ninguém claimar
 *   msUntilStreakLost: number,
 *   streakAtRisk: boolean,      já dá pra claimar e o streak morre em <12h
 *   willCompleteCycle: boolean, este claim fecha um ciclo de 7?
 *   amountLamports: number,     quanto este claim pagaria
 *   daysToNextPack: number,     quantos claims faltam pro próximo pacote
 * }}
 */
export function evaluateClaim(state, now = Date.now()) {
  const last = state?.lastClaimAt || 0;
  const currentStreak = effectiveStreak(state, now);

  // Quem nunca claimou pode claimar imediatamente.
  const nextClaimAt = last ? last + CLAIM_COOLDOWN_MS : 0;
  const msUntilNext = Math.max(0, nextClaimAt - now);

  const streakExpiresAt = last ? last + STREAK_GRACE_MS : 0;
  const msUntilStreakLost = Math.max(0, streakExpiresAt - now);

  const nextStreak = currentStreak + 1;
  const willCompleteCycle = nextStreak % STREAK_TARGET === 0;

  return {
    canClaim: msUntilNext === 0,
    currentStreak,
    nextStreak,
    nextClaimAt,
    msUntilNext,
    streakExpiresAt,
    msUntilStreakLost,

    // Janela em que o usuário PODE claimar e vai perder o streak se não o
    // fizer. É o único momento em que vale empurrar uma notificação — antes
    // disso ele não pode agir, depois já não há o que salvar.
    streakAtRisk:
      msUntilNext === 0 && currentStreak > 0 && msUntilStreakLost < 12 * 60 * 60 * 1000,

    willCompleteCycle,
    amountLamports: claimAmountLamports(nextStreak),

    // Quantos claims faltam pro próximo pacote. Com streak 7 (acabou de
    // ganhar um), faltam 7 — por isso o módulo é calculado sobre nextStreak,
    // não sobre currentStreak.
    daysToNextPack: STREAK_TARGET - (nextStreak % STREAK_TARGET || STREAK_TARGET) + 1,
  };
}

/**
 * Estado resultante de um claim confirmado.
 *
 * O streak NÃO volta a zero ao fechar um ciclo: ele cresce indefinidamente
 * (7, 14, 21…) e cada múltiplo de 7 rende um pacote. Resetar tornaria
 * `longestStreak` inútil — ficaria travado em 7 pra sempre — e apagaria a
 * conquista de quem mantém 30 dias seguidos, que é exatamente o
 * comportamento que o app quer premiar.
 *
 * @param {object} state       estado anterior (pode ser null)
 * @param {object} opts
 * @param {string} opts.wallet
 * @param {number} opts.now
 * @param {number} opts.lamports   quanto foi efetivamente transferido
 * @param {string} opts.signature  assinatura da transferência confirmada
 */
export function applyClaim(state, { wallet, now = Date.now(), lamports, signature }) {
  const base = state || emptyClaimState(wallet);
  const currentStreak = effectiveStreak(base, now);
  const nextStreak = currentStreak + 1;
  const completedCycle = nextStreak % STREAK_TARGET === 0;

  return {
    ...base,
    wallet,
    lastClaimAt: now,
    currentStreak: nextStreak,
    longestStreak: Math.max(base.longestStreak || 0, nextStreak),

    // Acumulado, nunca derivado de currentStreak: o streak pode zerar, mas
    // ter completado um ciclo é permanente — é o que libera a troca de
    // figurinhas pra sempre.
    completedCycles: (base.completedCycles || 0) + (completedCycle ? 1 : 0),

    totalClaims: (base.totalClaims || 0) + 1,
    totalLamportsClaimed: (base.totalLamportsClaimed || 0) + lamports,
    lastSignature: signature || '',
  };
}

/**
 * Reserva o claim ANTES da transferência.
 *
 * A transferência de SOL não é reversível e o servidor pode morrer entre
 * transferir e gravar. Se gravássemos só depois, uma queda nesse intervalo
 * deixaria o cooldown aberto e o retry pagaria de novo — a treasury perde
 * dinheiro. Reservando antes, uma queda deixa o cooldown FECHADO: no pior
 * caso o usuário perde um claim, que é o lado certo do erro.
 *
 * O `pending: true` marca a reserva. Confirmada, vira o estado definitivo
 * via `applyClaim`; falhando a transferência, o endpoint faz rollback pro
 * estado anterior.
 */
export function reserveClaim(state, { wallet, now = Date.now() }) {
  return {
    ...applyClaim(state, { wallet, now, lamports: 0, signature: '' }),
    pending: true,
  };
}

/** Formata o tempo restante do cooldown como "5h 12min" / "48min" / "30s". */
export function formatCountdown(ms) {
  if (ms <= 0) return '';
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  if (h > 0) return `${h}h ${String(min).padStart(2, '0')}min`;
  if (totalMin > 0) return `${totalMin}min`;
  return `${Math.ceil(ms / 1000)}s`;
}
