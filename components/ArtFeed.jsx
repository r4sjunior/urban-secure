/**
 * components/ArtFeed.jsx
 * Feed estilo Instagram com as últimas artes registradas.
 * Cada card: artista (com link pro perfil), mídia, like/coleta, "como chegar"
 * e botão de localização que fecha o feed e centraliza o mapa na obra.
 */
import Link from 'next/link';
import { X, Image, MapPin, Navigation } from 'lucide-react';
import LikeButton from './LikeButton';
import CommentsSection from './CommentsSection';
import FeedAvatar from './feed/FeedAvatar';
import { timeAgo } from '../lib/timeAgo';
import { googleMapsUrl } from '../lib/googleMaps';

/** Vídeo e imagem chegam no mesmo campo `imageUrl`. Sem carregar o metadata
 *  de cada obra, a extensão preservada pelo gateway do IPFS é o sinal
 *  disponível — barato e suficiente pra escolher <video> ou <img>. */
function isVideoUrl(url) {
  return /\.(webm|mp4)(\?|$)/i.test(url || '');
}

export default function ArtFeed({ open, onClose, arts = [], onLocate, isAuthenticated = false }) {
  if (!open) return null;

  const sorted = [...arts].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  return (
    <div className="feed-modal">
      <div className="feed-backdrop" onClick={onClose} />
      <div className="feed-panel">
        <div className="feed-header">
          <h2 className="feed-title">Feed</h2>
          <button className="feed-close" onClick={onClose} title="Fechar"><X className="lucide" /></button>
        </div>

        <div className="feed-list">
          {sorted.length === 0 && (
            <p className="feed-empty">Nenhuma arte registrada ainda. Seja o primeiro! <Image className="lucide" /></p>
          )}

          {sorted.map(art => {
            const media = (art.imageUrl || '').startsWith('https://') ? art.imageUrl : '';
            const mapsUrl = googleMapsUrl(art.lat, art.lng);
            const perfilUrl = art.artistWallet ? `/perfil/${encodeURIComponent(art.artistWallet)}` : null;

            return (
              <article className="feed-card" key={art.id}>
                <div className="feed-card-head">
                  <FeedAvatar wallet={art.artistWallet} fallbackName={art.artistName || art.name} />

                  <div className="feed-card-headinfo">
                    {perfilUrl ? (
                      <Link href={perfilUrl} className="feed-artist feed-artist-link" onClick={onClose}>
                        {art.artistName || 'Anônimo'}
                      </Link>
                    ) : (
                      <span className="feed-artist">{art.artistName || 'Anônimo'}</span>
                    )}
                    <span className="feed-time">{timeAgo(art.timestamp)}</span>
                  </div>

                  <button
                    className="feed-locate"
                    onClick={() => onLocate && onLocate(art)}
                    title="Ver no mapa"
                    aria-label="Ver no mapa"
                  >
                    <MapPin className="lucide" />
                  </button>
                </div>

                <div className="feed-media">
                  {!media ? (
                    <div className="feed-media-ph"><Image className="lucide" /></div>
                  ) : isVideoUrl(media) ? (
                    // Sem autoplay de propósito: um feed que dispara vários
                    // vídeos de uma vez queima o dado móvel do usuário e
                    // trava em celular fraco.
                    <video src={media} controls playsInline preload="metadata" />
                  ) : (
                    <img src={media} alt={art.name || 'Arte'} loading="lazy" />
                  )}
                </div>

                <div className="feed-card-body">
                  <div className="feed-actions">
                    <LikeButton postId={art.id} artistWallet={art.artistWallet} isAuthenticated={isAuthenticated} />
                  </div>

                  <p className="feed-desc">
                    <strong>{art.name}</strong> {art.description}
                  </p>

                  {mapsUrl && (
                    <a className="feed-maps" href={mapsUrl} target="_blank" rel="noopener noreferrer">
                      <Navigation className="lucide" /> Como chegar até a obra
                    </a>
                  )}

                  <CommentsSection postId={art.id} isAuthenticated={isAuthenticated} />
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}
