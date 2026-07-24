/**
 * components/profile/ProfileCard.jsx
 * Cabeçalho de perfil em modo leitura: avatar, nome, bio, redes, seguidores
 * e estatísticas.
 *
 * Serve tanto o perfil de terceiro (pages/perfil/[wallet].jsx) quanto o
 * próprio — quando é o próprio, ganha o botão de editar; quando é de outro,
 * ganha o de seguir. Um componente só evita que as duas telas divirjam.
 */

import { displayName, shortWallet } from '../../lib/social/profile';
import { Pencil } from 'lucide-react';
import { useFollow } from '../../lib/hooks/useFollow';
import Avatar from './Avatar';
import SocialLinks from './SocialLinks';
import StatsGrid from './StatsGrid';
import FollowButton from './FollowButton';

export default function ProfileCard({ profile, stats, wallet, isLoading, isSelf, onEdit }) {
  const address = profile?.wallet || wallet || '';
  const name = displayName(profile, address);
  const network = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet';

  // Uma leitura só, aqui em cima: os contadores aparecem em todo perfil,
  // inclusive no próprio, onde o botão de seguir não é renderizado.
  const follow = useFollow(address);

  return (
    <section className="profile-card">
      <div className="profile-card-head">
        <Avatar profile={profile} wallet={address} size={80} ring />

        <div className="profile-card-id">
          <h1 className="profile-card-name">{name}</h1>

          <a
            className="profile-card-addr"
            href={`https://explorer.solana.com/address/${address}?cluster=${network}`}
            target="_blank"
            rel="noopener noreferrer"
            title="Ver carteira no explorer"
          >
            {shortWallet(address)} ↗
          </a>
        </div>

        {isSelf ? (
          <button className="btn-ghost profile-card-edit" onClick={onEdit}>
            <Pencil className="lucide" /> Editar
          </button>
        ) : (
          <FollowButton follow={follow} />
        )}
      </div>

      {follow.followers !== null && (
        <div className="follow-counts">
          <span>
            <strong>{follow.followers}</strong>{' '}
            {follow.followers === 1 ? 'seguidor' : 'seguidores'}
          </span>
          <span><strong>{follow.following ?? 0}</strong> seguindo</span>
        </div>
      )}

      {profile?.bio && <p className="profile-card-bio">{profile.bio}</p>}

      <SocialLinks socials={profile?.socials} />

      <StatsGrid stats={stats} isLoading={isLoading} />
    </section>
  );
}
