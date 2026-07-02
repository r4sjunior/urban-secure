/**
 * components/ArtFeed.jsx
 * Feed estilo Instagram com as últimas artes registradas.
 * Cada card: avatar/artista, imagem, like (pago) e botão de localização
 * que fecha o feed e centraliza o mapa na obra.
 */
import LikeButton from './LikeButton';

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Math.max(0, Date.now() - ts);
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `há ${d}d`;
  return new Date(ts).toLocaleDateString('pt-BR');
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
                  <LikeButton postId={art.id} artistWallet={art.artistWallet} isAuthenticated={isAuthenticated} />
                  <p className="feed-desc">
                    <strong>{art.name}</strong> {art.description}
                  </p>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}
