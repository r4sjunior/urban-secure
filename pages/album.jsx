/**
 * pages/album.jsx
 * Álbum de figurinhas: pacotes a abrir, slots do álbum e repetidas.
 *
 * A ordem da tela é a ordem da intenção: primeiro o que dá pra fazer agora
 * (abrir pacote), depois o progresso (álbum), por último o que sobra
 * (repetidas para troca).
 */

import Head from 'next/head';
import { Gift, ArrowLeft, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/router';
import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useAlbum } from '../lib/hooks/useAlbum';
import { STREAK_TARGET } from '../lib/config';
import AlbumGrid from '../components/stickers/AlbumGrid';
import StickerCard from '../components/stickers/StickerCard';
import PackOpening from '../components/stickers/PackOpening';
import TradeModal from '../components/stickers/TradeModal';

export default function AlbumPage() {
  const router = useRouter();
  const wallet = useWallet();
  const { album, packs, canTrade, isLoading, isWorking, error, openPack, paste, refresh } = useAlbum();
  const [packOpen, setPackOpen] = useState(false);
  const [tradeOpen, setTradeOpen] = useState(false);
  const [feedback, setFeedback] = useState(null);

  async function handlePaste(slot) {
    // O slot conhece a arte; a figurinha correspondente está no bolso.
    const sticker = album.pocket.find(s => s.artId === slot.artId);
    if (!sticker) return;

    const res = await paste(sticker.mint);
    setFeedback(res.ok ? { ok: true, text: `Figurinha #${slot.albumNumber} colada!` } : { ok: false, text: res.error });
    setTimeout(() => setFeedback(null), 2600);
  }

  const connected = wallet.connected && !!wallet.publicKey;

  return (
    <>
      <Head>
        <title>Álbum · Urban Secure</title>
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
          <h1 className="album-title">Álbum de Figurinhas</h1>

          {!connected ? (
            <p className="album-empty">Conecte sua carteira para ver seu álbum.</p>
          ) : isLoading ? (
            <p className="album-empty">Carregando seu álbum…</p>
          ) : (
            <>
              {/* Pacotes a abrir — o que o usuário pode fazer AGORA vem primeiro */}
              {packs > 0 ? (
                <button className="pack-cta" onClick={() => setPackOpen(true)}>
                  <span className="pack-cta-icon"><Gift className="lucide" /></span>
                  <span className="pack-cta-text">
                    <strong>{packs} {packs === 1 ? 'pacote' : 'pacotes'} para abrir</strong>
                    <span>Toque para abrir</span>
                  </span>
                </button>
              ) : (
                <p className="album-hint">
                  Complete {STREAK_TARGET} dias seguidos de claim para ganhar um pacote.
                </p>
              )}

              {feedback && (
                <div className={feedback.ok ? 'transfer-ok' : 'err-box'}>
                  {feedback.ok ? '' : ''} {feedback.text}
                </div>
              )}
              {error && !feedback && <div className="err-box">{error}</div>}

              <AlbumGrid album={album} onPaste={handlePaste} isWorking={isWorking} />

              {/* Repetidas — o que circula na troca */}
              {album.duplicates.length > 0 && (
                <>
                  <h2 className="profile-section-title">
                    Repetidas <span className="count">{album.duplicates.length}</span>
                  </h2>
                  <p className="album-hint">
                    {canTrade
                      ? 'Estas você já tem coladas. Troque com outros colecionadores.'
                      : `Feche ${STREAK_TARGET} dias seguidos de claim para liberar as trocas.`}
                  </p>
                  <div className="album-dupes">
                    {album.duplicates.map(s => (
                      <StickerCard key={s.mint} sticker={s} size="sm" />
                    ))}
                  </div>
                  <button className="btn-ghost album-trade-cta" onClick={() => setTradeOpen(true)}>
                    <RefreshCw className="lucide" /> Abrir trocas
                  </button>
                </>
              )}

              {/* Bolso: ganhas e ainda não coladas nem repetidas */}
              {album.pocket.length > album.duplicates.length && (
                <>
                  <h2 className="profile-section-title">No bolso</h2>
                  <p className="album-hint">Toque em “Colar” no slot correspondente do álbum.</p>
                </>
              )}
            </>
          )}
        </main>

        <PackOpening
          open={packOpen}
          onOpenPack={openPack}
          onClose={() => { setPackOpen(false); refresh(); }}
          onRevealed={() => refresh()}
        />

        <TradeModal
          open={tradeOpen}
          onClose={() => setTradeOpen(false)}
          duplicates={album.duplicates}
          canTrade={canTrade}
          onDone={refresh}
        />
      </div>
    </>
  );
}
