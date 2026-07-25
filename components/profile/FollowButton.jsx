/**
 * components/profile/FollowButton.jsx
 * Botão de seguir. Só apresentação — o estado vive em lib/hooks/useFollow.js,
 * porque os contadores também aparecem onde este botão não existe (no perfil
 * próprio).
 */

import { Check, Plus, Loader2 } from 'lucide-react';
import { sound } from '../../lib/sound';

export default function FollowButton({ follow }) {
  const { isFollowing, busy, error, canFollow, carregando, toggle } = follow;

  // Sem carteira conectada, ou no próprio perfil, não há o que seguir.
  if (!canFollow) return null;

  return (
    <div className="follow-wrap">
      <button
        className={`follow-btn${isFollowing ? ' following' : ''}`}
        onClick={() => { sound.play('click'); toggle(); }}
        // Bloqueia só enquanto a ação está em curso ou o estado inicial ainda
        // não chegou. Antes, um `isFollowing` nulo vindo do servidor deixava
        // o botão desabilitado para sempre — o usuário via "···" e não
        // conseguia seguir ninguém.
        disabled={busy || carregando}
      >
        {busy
          ? <><Loader2 className="lucide spin" /> …</>
          : carregando
            ? '···'
            : isFollowing
              ? <><Check className="lucide" /> Seguindo</>
              : <><Plus className="lucide" /> Seguir</>}
      </button>
      {error && <span className="follow-err">{error}</span>}
    </div>
  );
}
