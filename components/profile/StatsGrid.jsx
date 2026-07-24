/**
 * components/profile/StatsGrid.jsx
 * As quatro estatísticas do perfil: artes, figurinhas, streak, ranking.
 *
 * A ordem é deliberada — vai do que o usuário já conquistou (artes) pro que
 * ele pode perder se parar (streak) pro que o coloca contra os outros
 * (ranking). É a ordem em que o app quer que ele pense.
 */

import { STREAK_TARGET } from '../../lib/config';

function Stat({ icon, value, label, hint, tone }) {
  return (
    <div className={`stat${tone ? ` stat-${tone}` : ''}`}>
      <span className="stat-icon">{icon}</span>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
      {hint && <span className="stat-hint">{hint}</span>}
    </div>
  );
}

export default function StatsGrid({ stats, isLoading }) {
  if (isLoading || !stats) {
    return (
      <div className="stats-grid">
        {[0, 1, 2, 3].map(i => <div key={i} className="stat stat-skeleton" />)}
      </div>
    );
  }

  const { artsRegistered, stickersCollected, currentStreak, weeklyRank, artsThisWeek } = stats;

  // Quantos dias faltam pro próximo pacote. Mostrar isso em vez de só o
  // número do streak transforma a estatística num objetivo.
  //
  // Sem o `|| STREAK_TARGET`: quem está no dia 7 (resto 0) acabou de ganhar
  // um pacote e tem 7 dias até o próximo, não zero — o módulo puro daria 0 e
  // esconderia a dica justamente de quem está engajado.
  const toNextPack = STREAK_TARGET - (currentStreak % STREAK_TARGET);

  const rankMedal = weeklyRank === 1 ? '🥇' : weeklyRank === 2 ? '🥈' : weeklyRank === 3 ? '🥉' : '📊';

  return (
    <div className="stats-grid">
      <Stat icon="🎨" value={artsRegistered} label="Artes" />
      <Stat icon="🃏" value={stickersCollected} label="Figurinhas" />
      <Stat
        icon="🔥"
        value={currentStreak}
        label="Streak"
        hint={currentStreak > 0 && toNextPack > 0 ? `${toNextPack}d p/ pacote` : null}
        tone={currentStreak > 0 ? 'hot' : null}
      />
      <Stat
        icon={rankMedal}
        value={weeklyRank ? `#${weeklyRank}` : '—'}
        label="Ranking"
        hint={artsThisWeek > 0 ? `${artsThisWeek} na semana` : 'sem artes'}
        tone={weeklyRank && weeklyRank <= 3 ? 'podium' : null}
      />
    </div>
  );
}
