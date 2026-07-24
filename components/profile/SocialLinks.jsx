/**
 * components/profile/SocialLinks.jsx
 * Campos de rede social (modo edição) e chips clicáveis (modo leitura).
 *
 * Guardamos só o handle; a URL é montada por `socialUrl` a partir do baseUrl
 * em lib/config.js. Isso é o que impede o campo de perfil de virar um vetor
 * pra apontar link a qualquer domínio — quem digitar uma URL inteira tem só
 * o último segmento aproveitado (ver normalizeSocialHandle).
 */

import { SOCIAL_PLATFORMS } from '../../lib/config';
import { socialUrl, normalizeSocialHandle } from '../../lib/social/profile';

const ICONS = {
  instagram: '📸',
  x: '𝕏',
  tiktok: '🎵',
  farcaster: '🟣',
};

/** Modo edição — um campo por plataforma. */
export function SocialInputs({ socials, onChange, disabled }) {
  return (
    <div className="social-inputs">
      {Object.entries(SOCIAL_PLATFORMS).map(([key, cfg]) => (
        <label key={key} className="social-input">
          <span className="social-input-icon" aria-hidden="true">{ICONS[key]}</span>
          <span className="social-input-prefix">@</span>
          <input
            className="social-input-fld"
            placeholder={cfg.label.toLowerCase()}
            value={socials?.[key] || ''}
            // Normaliza a cada tecla pra que colar a URL do perfil — o gesto
            // natural do usuário — vire o handle na frente dele, em vez de
            // ser silenciosamente descartado só no submit.
            onChange={e => onChange({ ...socials, [key]: normalizeSocialHandle(e.target.value) })}
            disabled={disabled}
            maxLength={30}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>
      ))}
    </div>
  );
}

/** Modo leitura — chips clicáveis. Não renderiza nada se não houver links. */
export default function SocialLinks({ socials }) {
  const entries = Object.entries(socials || {}).filter(([, handle]) => !!handle);
  if (entries.length === 0) return null;

  return (
    <div className="social-links">
      {entries.map(([key, handle]) => {
        const cfg = SOCIAL_PLATFORMS[key];
        if (!cfg) return null;
        return (
          <a
            key={key}
            className="social-chip"
            href={socialUrl(key, handle)}
            target="_blank"
            // noopener impede que a página aberta acesse window.opener e
            // possa redirecionar a nossa aba (tabnabbing).
            rel="noopener noreferrer"
          >
            <span aria-hidden="true">{ICONS[key]}</span>
            <span className="social-chip-handle">@{handle}</span>
          </a>
        );
      })}
    </div>
  );
}
