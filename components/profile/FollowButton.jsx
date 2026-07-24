/**
 * components/profile/FollowButton.jsx
 * Botão de seguir. Só apresentação — o estado vive em lib/hooks/useFollow.js,
 * porque os contadores também aparecem onde este botão não existe (no perfil
 * próprio).
 */

import { Check, Plus } from 'lucide-react';
import { sound } from '../../lib/sound';

export default function FollowButton({ follow }) {
  const { isFollowing, busy, error, canFollow, toggle } = follow;

  // Sem carteira conectada, ou no próprio perfil, não há o que seguir.
  if (!canFollow) return null;

  return (
    <div className="follow-wrap">
      <button
        className={`follow-btn${isFollowing ? ' following' : ''}`}
        onClick={() => { sound.play('click'); toggle(); }}
        // `isFollowing === null` é "ainda não sei" — desabilitar evita o
        // botão aparecer como "+ Seguir" para quem já segue e o clique
        // desfazer o que a pessoa não quis desfazer.
        disabled={busy || isFollowing === null}
      >
        {isFollowing === null ? '···' : isFollowing ? <><Check className="lucide" /> Seguindo</> : <><Plus className="lucide" /> Seguir</>}
      </button>
      {error && <span className="follow-err">{error}</span>}
    </div>
  );
}
