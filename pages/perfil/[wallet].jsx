/**
 * pages/perfil/[wallet].jsx
 * Perfil público de um artista: cabeçalho + galeria das artes registradas.
 *
 * Rota compartilhável — é o que permite o artista divulgar o próprio trabalho
 * fora do app, e é o destino de todo nome de artista clicado no mapa e no
 * feed. Sem isso, o app teria perfis mas nenhum jeito de chegar até eles.
 */

import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { useState, useMemo } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useProfile } from '../../lib/hooks/useProfile';
import { useArts } from '../../context/ArtsContext';
import { displayName, SOLANA_ADDR_RE } from '../../lib/social/profile';
import { timeAgo } from '../../lib/timeAgo';
import ProfileCard from '../../components/profile/ProfileCard';
import ProfileSheet from '../../components/profile/ProfileSheet';

export default function ProfilePage() {
  const router = useRouter();
  const wallet = useWallet();
  const [editOpen, setEditOpen] = useState(false);

  const raw = router.query.wallet;
  const address = typeof raw === 'string' ? raw : '';

  const { profile, stats, isLoading } = useProfile(SOLANA_ADDR_RE.test(address) ? address : null);
  const { arts } = useArts();

  // Reusa o registry que o ArtsContext já carregou pro mapa em vez de pedir
  // ao servidor de novo — a lista completa já está em memória.
  const myArts = useMemo(
    () => arts
      .filter(a => a.artistWallet === address)
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)),
    [arts, address]
  );

  const isSelf = wallet.publicKey?.toBase58() === address;
  const name = displayName(profile, address);

  // router.query fica vazio no primeiro render (antes da hidratação da rota)
  if (!router.isReady) return <div className="profile-page" />;

  if (!SOLANA_ADDR_RE.test(address)) {
    return (
      <div className="profile-page">
        <div className="profile-empty">
          <p>Endereço de carteira inválido.</p>
          <Link href="/" className="btn-ghost">← Voltar ao mapa</Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>{`${name} · Urban Secure`}</title>
        <meta name="description" content={profile?.bio || `Artes urbanas registradas por ${name}.`} />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="theme-color" content="#0a0a0f" />
      </Head>

      <div className="profile-page">
        <div className="bg-mesh" />
        <div className="bg-grid" />

        <header className="profile-topbar">
          <button className="btn-ghost" onClick={() => router.push('/')}>← Mapa</button>
        </header>

        <main className="profile-main">
          <ProfileCard
            profile={profile}
            stats={stats}
            wallet={address}
            isLoading={isLoading}
            isSelf={isSelf}
            onEdit={() => setEditOpen(true)}
          />

          <h2 className="profile-section-title">
            Artes registradas {myArts.length > 0 && <span className="count">{myArts.length}</span>}
          </h2>

          {myArts.length === 0 ? (
            <p className="profile-empty-arts">
              {isSelf
                ? 'Você ainda não registrou nenhuma arte. Volte ao mapa e registre a primeira.'
                : 'Este artista ainda não registrou artes.'}
            </p>
          ) : (
            <div className="profile-arts-grid">
              {myArts.map(art => (
                <Link
                  key={art.id}
                  href={{ pathname: '/', query: { arte: art.id } }}
                  className="profile-art"
                  title={art.name}
                >
                  {art.imageUrl
                    ? <img src={art.imageUrl} alt={art.name} loading="lazy" />
                    : <span className="profile-art-ph">🎨</span>}
                  <span className="profile-art-meta">{timeAgo(art.timestamp)}</span>
                </Link>
              ))}
            </div>
          )}
        </main>

        {isSelf && <ProfileSheet open={editOpen} onClose={() => setEditOpen(false)} />}
      </div>
    </>
  );
}
