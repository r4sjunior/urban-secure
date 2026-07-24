/**
 * components/claim/ClaimButton.jsx
 * CTA do claim, com contador regressivo ao vivo.
 *
 * O tick de 1s vive aqui, não no ClaimContext — ver o comentário de topo
 * daquele arquivo. Só este botão re-renderiza por segundo, e apenas enquanto
 * o sheet está aberto.
 */

import { useState, useEffect } from 'react';
import { formatCountdown } from '../../lib/social/claim';
import { sound } from '../../lib/sound';

export default function ClaimButton({ status, isClaiming, onClaim, disabled }) {
  const { canClaim, nextClaimAt, amountSol, willCompleteCycle } = status;

  // Recalcula a partir do relógio local a cada segundo. Usa `nextClaimAt`
  // (instante absoluto) em vez do `msUntilNext` que veio na resposta, senão
  // o contador congelaria no valor do momento do fetch e a aba deixada aberta
  // por horas mostraria um tempo que já passou.
  const [remaining, setRemaining] = useState(() => Math.max(0, nextClaimAt - Date.now()));

  useEffect(() => {
    if (canClaim) { setRemaining(0); return; }

    const tick = () => setRemaining(Math.max(0, nextClaimAt - Date.now()));
    tick();

    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [canClaim, nextClaimAt]);

  // O servidor é a autoridade sobre o cooldown; o relógio local só antecipa a
  // habilitação visual. Quando o contador zera, o usuário pode tentar — e se
  // o relógio dele estiver adiantado, o servidor recusa e devolve o status
  // correto, que reabre o contador.
  const ready = canClaim || remaining === 0;

  if (isClaiming) {
    return <button className="mint-cta" disabled>⏳ Resgatando…</button>;
  }

  if (!ready) {
    return (
      <button className="mint-cta claim-cta-wait" disabled>
        <span className="claim-cta-label">Próximo resgate em</span>
        <span className="claim-cta-time">{formatCountdown(remaining)}</span>
      </button>
    );
  }

  return (
    <button
      className={`mint-cta${willCompleteCycle ? ' claim-cta-bonus' : ''}`}
      onClick={() => { sound.play('click'); onClaim(); }}
      disabled={disabled}
    >
      {willCompleteCycle
        ? `🎁 Resgatar ${amountSol.toFixed(4)} SOL + pacote`
        : `⚡ Resgatar ${amountSol.toFixed(4)} SOL`}
    </button>
  );
}
