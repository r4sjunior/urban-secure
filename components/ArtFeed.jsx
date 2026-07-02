/**
 * components/ArtFeed.jsx
 * Feed estilo Instagram com as últimas artes registradas.
 * Cada card: avatar/artista, imagem, like (pago) e botão de localização
 * que fecha o feed e centraliza o mapa na obra.
 */
import LikeButton from './LikeButton';
import CollectButton from './CollectButton';
import CommentsSection from './CommentsSection';
import { timeAgo } from '../lib/timeAgo';

export default function ArtFeed({ open, onClose, arts = [], onLocate, isAuthenticated = false }) {
  if (!open) return null;

  const sorted = [...arts].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  return (
    <div className="feed-modal">
      <div className="feed-backdrop" onClick={onClose} />
      <div className="feed-panel">
        <div className="feed-header">
          <h2 className="feed-title">Feed</h2>
          <button className="feed-close" onClick={onClose} title="Fechar">✕</button>
        </div>

        <div className="feed-list">
          {sorted.length === 0 && (
            <p className="feed-empty">Nenhuma arte registrada ainda. Seja o primeiro! 🎨</p>
          )}

          {sorted.map(art => {
            const img = (art.imageUrl || '').startsWith('https://') ? art.imageUrl : '';
            const initial = (art.artistName || art.name || '?').trim().charAt(0).toUpperCase() || '?';
            return (
              <article className="feed-card" key={art.id}>
                <div className="feed-card-head">
                  <div className="feed-avatar">{initial}</div>
                  <div className="feed-card-headinfo">
                    <span className="feed-artist">{art.artistName || 'Anônimo'}</span>
                    <span className="feed-time">{timeAgo(art.timestamp)}</span>
                  </div>
                  <button
                    className="feed-locate"
                    onClick={() => onLocate && onLocate(art)}
                    title="Ver no mapa"
                    aria-label="Ver no mapa"
                  >
                    📍
                  </button>
                </div>

                <div className="feed-media">
                  {img
                    ? <img src={img} alt={art.name || 'Arte'} loading="lazy" />
                    : <div className="feed-media-ph">🎨</div>}
                </div>

                <div className="feed-card-body">
                  <div className="feed-actions">
                    <LikeButton postId={art.id} artistWallet={art.artistWallet} isAuthenticated={isAuthenticated} />
                    <CollectButton art={art} isAuthenticated={isAuthenticated} />
                  </div>
                  <p className="feed-desc">
                    <strong>{art.name}</strong> {art.description}
                  </p>
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
