/**
 * components/profile/Avatar.jsx
 * Foto de perfil circular, com fallback gerado a partir da carteira.
 *
 * Usado em todo lugar onde aparece um usuário — popup do mapa, feed, ranking,
 * álbum. O fallback é determinístico (cor derivada do endereço + inicial), o
 * que dá a cada carteira uma identidade visual estável sem exigir upload:
 * mesmo quem nunca abriu o perfil é reconhecível na lista.
 */

import { useState } from 'react';
import { walletColor, displayName } from '../../lib/social/profile';

export default function Avatar({ profile, wallet, size = 40, ring = false }) {
  const [broken, setBroken] = useState(false);

  const address = profile?.wallet || wallet || '';
  const url = profile?.avatarUrl;
  const name = displayName(profile, address);

  // Inicial do handle quando existe; senão o primeiro caractere do endereço.
  const initial = (profile?.handle?.trim()?.[0] || address[0] || '?').toUpperCase();

  const style = {
    width: size,
    height: size,
    fontSize: Math.round(size * 0.42),
  };

  if (url && !broken) {
    return (
      <img
        className={`avatar${ring ? ' avatar-ring' : ''}`}
        style={style}
        src={url}
        alt={name}
        loading="lazy"
        // Gateway do IPFS cai de vez em quando. Cair pro fallback gerado é
        // melhor que um ícone de imagem quebrada num app cheio de avatares.
        onError={() => setBroken(true)}
      />
    );
  }

  return (
    <div
      className={`avatar avatar-fallback${ring ? ' avatar-ring' : ''}`}
      style={{ ...style, background: walletColor(address) }}
      title={name}
      aria-label={name}
    >
      {initial}
    </div>
  );
}
