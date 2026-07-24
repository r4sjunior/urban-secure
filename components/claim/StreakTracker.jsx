/**
 * components/claim/StreakTracker.jsx
 * Trilha visual do ciclo de 7 dias, com o pacote no fim.
 *
 * Mostra a posição DENTRO do ciclo atual, não o streak absoluto: quem está no
 * dia 23 vê "2 de 7", porque o que importa pra decisão de voltar amanhã é
 * quanto falta pro próximo pacote, não o número total. O total aparece
 * separado, como conquista.
 */

import { STREAK_TARGET } from '../../lib/config';
import { Gift, Check } from 'lucide-react';

export default function StreakTracker({ currentStreak = 0, nextIsClaimable = false }) {
  // Posição no ciclo. Streak 7 dá resto 0, mas representa um ciclo CHEIO —
  // sem este ajuste a trilha zeraria bem no momento da conquista.
  const raw = currentStreak % STREAK_TARGET;
  const posInCycle = currentStreak > 0 && raw === 0 ? STREAK_TARGET : raw;

  const cyclesDone = Math.floor(currentStreak / STREAK_TARGET);

  return (
    <div className="streak-tracker">
      <div className="streak-trail">
        {Array.from({ length: STREAK_TARGET }, (_, i) => {
          const day = i + 1;
          const done = day <= posInCycle;
          const isNext = day === posInCycle + 1 && nextIsClaimable;
          const isLast = day === STREAK_TARGET;

          return (
            <div
              key={day}
              className={`streak-day${done ? ' done' : ''}${isNext ? ' next' : ''}${isLast ? ' last' : ''}`}
              title={isLast ? 'Fecha o ciclo e libera um pacote' : `Dia ${day}`}
            >
              {isLast ? <Gift className="lucide" /> : done ? <Check className="lucide" /> : day}
            </div>
          );
        })}
      </div>

      <div className="streak-legend">
        <span className="streak-count">
          <strong>{currentStreak}</strong> {currentStreak === 1 ? 'dia' : 'dias'} seguidos
        </span>
        {cyclesDone > 0 && (
          <span className="streak-cycles">
            {cyclesDone} {cyclesDone === 1 ? 'ciclo fechado' : 'ciclos fechados'}
          </span>
        )}
      </div>
    </div>
  );
}
