/**
 * pages/api/cron/weekly-payout.js
 * Premiação semanal — roda toda segunda às 00:10 (Brasília) via Vercel Cron.
 *
 * Paga o pódio da semana que acabou: 1º 0.05 SOL, 2º 50% disso, 3º 30%
 * (lib/config.js). Transferências reais da treasury, com memo, auditáveis
 * na chain.
 *
 * DUAS PROTEÇÕES QUE NÃO SÃO OPCIONAIS:
 *
 * 1. AUTENTICAÇÃO. Sem o header `Authorization: Bearer $CRON_SECRET`,
 *    qualquer pessoa dispararia a premiação por HTTP e drenaria a treasury
 *    repetindo a chamada. A rota é pública por natureza — a Vercel a invoca
 *    pela internet.
 *
 * 2. IDEMPOTÊNCIA. A Vercel reexecuta cron que falha ou dá timeout. Sem
 *    registro do que já foi pago, um retry pagaria o pódio de novo. O
 *    identificador ISO da semana ("2026-W30") é a chave: existindo payout
 *    pra ela, o cron não faz nada.
 */

import { getLatestPin, getLatestPinStrict, mutatePin, MutationAbort } from '../../../lib/pinataStore';
import { REGISTRY, PROFILES, WEEKLY_PAYOUTS } from '../../../lib/collections';
import { previousWeek, rankArtists } from '../../../lib/social/weekly';
import { displayName } from '../../../lib/social/profile';
import { getTreasuryBalance, transferFromTreasury } from '../../../lib/treasury';
import {
  WEEKLY_PRIZE_SPLIT, weeklyPrizeLamports,
  TREASURY_RESERVE_SOL, LAMPORTS_PER_SOL,
} from '../../../lib/config';

/** Comparação em tempo constante — evita que a diferença de tempo entre um
 *  segredo errado no primeiro caractere e no último vaze o valor. */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Falha fechado: sem segredo configurado, ninguém paga nada. O contrário
    // seria uma rota de pagamento aberta por esquecimento de env var.
    console.error('[cron/weekly-payout] CRON_SECRET ausente — premiação desativada.');
    return res.status(500).json({ error: 'Cron não configurado.' });
  }

  const auth = req.headers.authorization || '';
  if (!safeEqual(auth, `Bearer ${secret}`)) {
    return res.status(401).json({ error: 'Não autorizado.' });
  }

  const jwt = process.env.PINATA_JWT;
  if (!jwt) return res.status(500).json({ error: 'Servidor não configurado.' });

  const week = previousWeek();

  try {
    // O histórico usa a leitura ESTRITA: é ele que decide se já pagamos, e
    // "não consegui ler" não pode virar "nunca paguei" — isso pagaria o
    // pódio duas vezes. Registry e perfis podem usar a leitura tolerante:
    // no pior caso o ranking sai vazio e ninguém recebe indevidamente.
    const [payouts, arts, profiles] = await Promise.all([
      getLatestPinStrict(jwt, WEEKLY_PAYOUTS, []),
      getLatestPin(jwt, REGISTRY, []),
      getLatestPin(jwt, PROFILES, {}),
    ]);

    const history = Array.isArray(payouts) ? payouts : [];

    // Trava de idempotência (ver o topo do arquivo).
    if (history.some(p => p?.week === week.id)) {
      return res.status(200).json({ ok: true, skipped: 'already-paid', week: week.id });
    }

    const ranking = rankArtists(Array.isArray(arts) ? arts : [], week);
    if (ranking.length === 0) {
      // Semana sem nenhuma arte: grava o payout vazio mesmo assim, senão o
      // cron reprocessaria essa semana em toda execução futura.
      await recordPayout(jwt, { week: week.id, paidAt: Date.now(), winners: [] });
      return res.status(200).json({ ok: true, week: week.id, winners: [], note: 'sem participantes' });
    }

    const podium = ranking.slice(0, WEEKLY_PRIZE_SPLIT.length);
    const totalLamports = podium.reduce((sum, _, i) => sum + weeklyPrizeLamports(i), 0);

    const balance = await getTreasuryBalance();
    const reserve = Math.round(TREASURY_RESERVE_SOL * LAMPORTS_PER_SOL);
    if (balance - totalLamports < 0) {
      // Não paga pela metade: um pódio parcialmente premiado é pior que um
      // pagamento adiado, porque não dá pra retomar sem pagar alguém duas
      // vezes. Falha alto e espera o operador recarregar a treasury.
      console.error('[cron/weekly-payout] saldo insuficiente', {
        balance: balance / LAMPORTS_PER_SOL,
        needed: totalLamports / LAMPORTS_PER_SOL,
      });
      return res.status(503).json({ error: 'Saldo insuficiente na treasury.', week: week.id });
    }
    if (balance - totalLamports < reserve) {
      console.warn('[cron/weekly-payout] premiação vai abaixo da reserva — pagando mesmo assim',
        { restante: (balance - totalLamports) / LAMPORTS_PER_SOL });
    }

    const profileMap = profiles && typeof profiles === 'object' ? profiles : {};
    const winners = [];

    // Sequencial, não em paralelo: transações da mesma carteira em paralelo
    // disputam o mesmo blockhash e algumas falham por duplicidade. São no
    // máximo 3 pagamentos — o ganho de paralelizar não compensa o risco.
    for (let i = 0; i < podium.length; i++) {
      const entry = podium[i];
      const lamports = weeklyPrizeLamports(i);
      if (lamports <= 0) continue;

      try {
        const signature = await transferFromTreasury({
          toWallet: entry.wallet,
          lamports,
          memo: `urban-premio ${week.id} #${i + 1}`,
        });

        winners.push({
          wallet: entry.wallet,
          handle: displayName(profileMap[entry.wallet], entry.wallet),
          position: i + 1,
          artsCount: entry.artsCount,
          lamports,
          signature,
        });
      } catch (err) {
        // Um pagamento falhando não impede os outros — quem ficou em 2º não
        // deve perder o prêmio porque a carteira do 1º deu problema. O
        // registro guarda só quem realmente recebeu.
        console.error('[cron/weekly-payout] falha ao pagar', entry.wallet, err.message);
      }
    }

    await recordPayout(jwt, { week: week.id, paidAt: Date.now(), winners });

    console.log('[cron/weekly-payout]', week.id, winners.length, 'pagos');
    return res.status(200).json({ ok: true, week: week.id, winners });
  } catch (err) {
    console.error('[cron/weekly-payout]', err.message);
    return res.status(500).json({ error: 'Erro na premiação.', week: week.id });
  }
}

/** Grava o payout. Reconfere a duplicidade dentro da mutação porque duas
 *  execuções do cron podem se cruzar. */
async function recordPayout(jwt, payout) {
  const mutation = await mutatePin(jwt, WEEKLY_PAYOUTS, [], (raw) => {
    const history = Array.isArray(raw) ? raw : [];
    if (history.some(p => p?.week === payout.week)) {
      throw new MutationAbort({ duplicate: true });
    }
    return { data: [...history, payout], result: { ok: true } };
  });

  if (!mutation.ok && !mutation.aborted) {
    // O SOL já saiu. Sem o registro, o próximo cron pagaria de novo — por
    // isso o log é alto: exige conferência manual.
    console.error('[cron/weekly-payout] PAGOU MAS NÃO REGISTROU', payout.week, payout.winners.map(w => w.signature));
  }
}
