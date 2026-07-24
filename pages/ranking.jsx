/**
 * pages/ranking.jsx
 * Ranking semanal: pódio, tabela e contagem regressiva até a apuração.
 *
 * A contagem regressiva é o elemento central da tela — é ela que transforma
 * "estou em 4º" em "ainda dá tempo". Um ranking sem prazo visível é só uma
 * lista.
 */

import Head from 'next/head';
import { ArrowLeft, Medal } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useState, useEffect, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import Avatar from '../components/profile/Avatar';
import { WEEKLY_PRIZE_SOL } from '../lib/config';

// Medalha no pódio; posição em número no restante.
const PODIUM = 3;

/** "2d 14h 03min" — a granularidade cai conforme o prazo aperta, pra que os
 *  segundos só apareçam quando realmente importam. */
function formatRemaining(ms) {
  if (ms <= 0) return 'apurando…';
  const totalMin = Math.floor(ms / 60000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}min`;
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}min ${String(s).padStart(2, '0')}s`;
}

export default function RankingPage() {
  const router = useRouter();
  const wallet = useWallet();
  const me = wallet.publicKey?.toBase58() || null;

  const [data, setData] = useState(null);
  const [showPrevious, setShowPrevious] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [remaining, setRemaining] = useState(0);

  const load = useCallback(async (previous) => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/ranking${previous ? '?week=anterior' : ''}`);
      const json = await res.json();
      if (res.ok) { setData(json); setRemaining(json.msUntilEnd || 0); }
    } catch (err) {
      console.error('[ranking]', err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { load(showPrevious); }, [showPrevious, load]);

  // Conta a partir do relógio local, sem refazer o request a cada segundo.
  useEffect(() => {
    if (showPrevious || !data?.week?.end) return;
    const tick = () => setRemaining(Math.max(0, data.week.end - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [data, showPrevious]);

  const entries = data?.entries || [];
  const myEntry = me ? entries.find(e => e.wallet === me) : null;

  return (
    <>
      <Head>
        <title>Ranking Semanal · Urban Secure</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        {/* Valor inicial; o ThemeContext o reescreve conforme o tema ativo. */}
        <meta name="theme-color" content="#0A0B0D" />
      </Head>

      <div className="profile-page">
        <div className="bg-mesh" />
        <div className="bg-grid" />

        <header className="profile-topbar">
          <button className="btn-ghost" onClick={() => router.push('/')}><ArrowLeft className="lucide" /> Mapa</button>
        </header>

        <main className="profile-main">
          <h1 className="album-title">Ranking Semanal</h1>

          <div className="rank-tabs">
            <button className={`rank-tab${!showPrevious ? ' on' : ''}`} onClick={() => setShowPrevious(false)}>
              Esta semana
            </button>
            <button className={`rank-tab${showPrevious ? ' on' : ''}`} onClick={() => setShowPrevious(true)}>
              Semana passada
            </button>
          </div>

          {!showPrevious && (
            <div className="rank-countdown">
              <span className="rank-countdown-label">Apuração em</span>
              <strong className="rank-countdown-time">{formatRemaining(remaining)}</strong>
              <span className="rank-countdown-note">
                Premiação automática toda segunda · {WEEKLY_PRIZE_SOL} SOL para o 1º lugar
              </span>
            </div>
          )}

          {showPrevious && data?.payout && (
            <div className="rank-paid">
              Premiação paga em {new Date(data.payout.paidAt).toLocaleDateString('pt-BR')}
            </div>
          )}
          {showPrevious && data && !data.payout && (
            <div className="rank-pending">Premiação ainda não processada.</div>
          )}

          {isLoading ? (
            <p className="album-empty">Apurando…</p>
          ) : entries.length === 0 ? (
            <p className="album-empty">
              Nenhuma arte registrada {showPrevious ? 'na semana passada' : 'nesta semana'} ainda.
              Registre a primeira e assuma a liderança.
            </p>
          ) : (
            <>
              {/* Minha posição, fixa no topo — quem abre o ranking quer saber
                  onde está antes de olhar quem ganhou. */}
              {myEntry && (
                <div className="rank-me">
                  <span className="rank-me-pos">#{myEntry.position}</span>
                  <span className="rank-me-text">
                    Você está em <strong>{myEntry.position}º</strong> com {myEntry.artsCount}{' '}
                    {myEntry.artsCount === 1 ? 'arte' : 'artes'}
                  </span>
                  {myEntry.prizeSol != null && (
                    <span className="rank-me-prize">{myEntry.prizeSol} SOL</span>
                  )}
                </div>
              )}

              <ol className="rank-list">
                {entries.map(entry => {
                  const isMe = entry.wallet === me;
                  const isPodium = entry.position <= PODIUM;

                  return (
                    <li key={entry.wallet} className={`rank-row${isPodium ? ' podium' : ''}${isMe ? ' me' : ''}`}>
                      <span className="rank-pos">{isPodium ? <Medal className="lucide" /> : entry.position}</span>

                      <Link href={`/perfil/${encodeURIComponent(entry.wallet)}`} className="rank-user">
                        <Avatar
                          profile={{ handle: entry.handle, avatarUrl: entry.avatarUrl, wallet: entry.wallet }}
                          wallet={entry.wallet}
                          size={34}
                        />
                        <span className="rank-handle">{entry.handle}</span>
                      </Link>

                      <span className="rank-count">
                        {entry.artsCount}
                        <small>{entry.artsCount === 1 ? 'arte' : 'artes'}</small>
                      </span>

                      {entry.prizeSol != null && (
                        <span className="rank-prize">{entry.prizeSol} SOL</span>
                      )}
                    </li>
                  );
                })}
              </ol>

              {data?.totalArtists > entries.length && (
                <p className="album-hint">
                  Mostrando os {entries.length} primeiros de {data.totalArtists} artistas.
                </p>
              )}
            </>
          )}
        </main>
      </div>
    </>
  );
}
