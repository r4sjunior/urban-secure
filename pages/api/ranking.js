/**
 * pages/api/ranking.js
 * GET /api/ranking          → ranking da semana corrente
 * GET /api/ranking?week=ant → semana anterior (a que foi premiada na segunda)
 *
 * Só leitura. A apuração vive em lib/social/weekly.js (pura e testada) e é a
 * MESMA função usada pelo cron de premiação — se fossem duas implementações,
 * a tela poderia mostrar um pódio e o pagamento sair para outro.
 */

import { getLatestPin } from '../../lib/pinataStore';
import { REGISTRY, PROFILES, WEEKLY_PAYOUTS } from '../../lib/collections';
import { currentWeek, previousWeek, rankArtists, msUntilWeekEnd } from '../../lib/social/weekly';
import { displayName } from '../../lib/social/profile';
import { WEEKLY_PRIZE_SPLIT, weeklyPrizeLamports, LAMPORTS_PER_SOL } from '../../lib/config';

// Quantas posições a tela mostra. O pódio paga 3; o resto aparece pra dar
// noção de quanto falta pra entrar nele.
const TOP_N = 50;

export default async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const jwt = process.env.PINATA_JWT;
  if (!jwt) return res.status(500).json({ error: 'Servidor não configurado.' });

  try {
    const wantsPrevious = req.query.week === 'anterior';
    const window = wantsPrevious ? previousWeek() : currentWeek();

    const [arts, profiles, payouts] = await Promise.all([
      getLatestPin(jwt, REGISTRY, []),
      getLatestPin(jwt, PROFILES, {}),
      getLatestPin(jwt, WEEKLY_PAYOUTS, []),
    ]);

    const profileMap = profiles && typeof profiles === 'object' ? profiles : {};
    const ranking = rankArtists(Array.isArray(arts) ? arts : [], window);

    const entries = ranking.slice(0, TOP_N).map(entry => {
      const profile = profileMap[entry.wallet] || null;
      return {
        wallet: entry.wallet,
        position: entry.position,
        artsCount: entry.artsCount,
        handle: displayName(profile, entry.wallet),
        avatarUrl: profile?.avatarUrl || '',
        // Prêmio só existe pro pódio; o resto vem null pra UI não precisar
        // saber quantas posições pagam.
        prizeSol: entry.position <= WEEKLY_PRIZE_SPLIT.length
          ? weeklyPrizeLamports(entry.position - 1) / LAMPORTS_PER_SOL
          : null,
      };
    });

    const paid = (Array.isArray(payouts) ? payouts : []).find(p => p?.week === window.id) || null;

    // Sem cache: a posição muda a cada arte registrada, e ver o pódio
    // desatualizado numa competição que paga SOL corrói a confiança na
    // apuração inteira.
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      week: { id: window.id, start: window.start, end: window.end },
      isCurrent: !wantsPrevious,
      msUntilEnd: wantsPrevious ? 0 : msUntilWeekEnd(),
      entries,
      totalArtists: ranking.length,
      // Se já foi paga, devolve as assinaturas — a premiação é verificável
      // na chain por qualquer um, não só uma promessa da interface.
      payout: paid ? { paidAt: paid.paidAt, winners: paid.winners } : null,
    });
  } catch (err) {
    console.error('[/api/ranking]', err.message);
    return res.status(500).json({ error: 'Erro ao apurar o ranking.' });
  }
}
