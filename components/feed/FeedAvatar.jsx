/**
 * components/feed/FeedAvatar.jsx
 * Avatar do artista no feed, buscando o perfil real da carteira.
 *
 * Separado do <Avatar> puro porque aqui há I/O: o feed só conhece a carteira
 * do artista, e a foto vem do perfil. O hook useProfile deduplica requests da
 * mesma carteira e cacheia por 5 minutos — sem isso, um feed com 30 posts do
 * mesmo artista dispararia 30 requisições idênticas.
 *
 * Enquanto carrega, mostra o fallback gerado (cor derivada da carteira), que
 * é o mesmo que ficaria caso o artista não tenha perfil. A troca é discreta
 * e a lista nunca fica com buracos.
 */

import { useProfile } from '../../lib/hooks/useProfile';
import Avatar from '../profile/Avatar';

export default function FeedAvatar({ wallet, fallbackName }) {
  const { profile } = useProfile(wallet || null);

  // Sem carteira (arte antiga sem autor registrado) não há perfil a buscar —
  // usa a inicial do nome exibido só pra não deixar o card sem identidade.
  const shown = profile || { handle: fallbackName || '', avatarUrl: '', wallet: wallet || '' };

  return <Avatar profile={shown} wallet={wallet} size={38} />;
}
