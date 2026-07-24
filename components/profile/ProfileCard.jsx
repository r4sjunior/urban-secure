/**
 * components/profile/ProfileCard.jsx
 * Cabeçalho de perfil em modo leitura: avatar, nome, bio, redes e stats.
 *
 * Serve tanto o perfil de terceiro (pages/perfil/[wallet].jsx) quanto o
 * próprio — quando é o próprio, ganha o botão de editar em vez de um botão
 * de ação social. Um componente só evita que as duas telas divirjam com o
 * tempo.
 */

import { displayName, shortWallet } from '../../lib/social/profile';
import Avatar from './Avatar';
import SocialLinks from './SocialLinks';
import StatsGrid from './StatsGrid';

export default function ProfileCard({ profile, stats, wallet, isLoading, isSelf, onEdit }) {
  const address = profile?.wallet || wallet || '';
  const name = displayName(profile, address);
  const network = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet';

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

        {isSelf && (
          <button className="btn-ghost profile-card-edit" onClick={onEdit}>
            ✏️ Editar
          </button>
        )}
      </div>

      {profile?.bio && <p className="profile-card-bio">{profile.bio}</p>}

      <SocialLinks socials={profile?.socials} />

      <StatsGrid stats={stats} isLoading={isLoading} />
    </section>
  );
}
