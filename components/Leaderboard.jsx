/**
 * components/Leaderboard.jsx
 * Ranking das 100 artes mais curtidas (likes pagos). Troféu para 1º, 2º e 3º lugar.
 * Toque no botão de local para centralizar o mapa na obra.
 */
import { useState, useEffect } from 'react';

const MAX_POSITIONS = 100;
const TROPHIES = { 1: '🥇', 2: '🥈', 3: '🥉' };

export default function Leaderboard({ open, onClose, arts = [], onLocate }) {
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancel = false;
    (async () => {
      setLoading(true);
      try {
        const r = await fetch('/api/likes');
        if (!r.ok) return;
        const data = await r.json();
        if (!cancel) setCounts(data.counts || {});
      } catch (e) {
        console.error('[Leaderboard]', e.message);
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [open]);

  if (!open) return null;

  const ranked = arts
    .map(a => ({ ...a, likes: counts[a.id] || 0 }))
    .sort((a, b) => b.likes - a.likes || (a.timestamp || 0) - (b.timestamp || 0))
    .slice(0, MAX_POSITIONS);

  return (
    <div className="lb-modal">
      <div className="lb-backdrop" onClick={onClose} />
      <div className="lb-panel">
        <div className="lb-header">
          <h2 className="lb-title">🏆 Leaderboard</h2>
          <button className="lb-close" onClick={onClose} title="Fechar">✕</button>
        </div>

        {loading && ranked.length === 0 && (
          <div className="lb-loading">
            <div className="map-spinner" />
            <span>Carregando ranking…</span>
          </div>
        )}

        {!loading && ranked.length === 0 && (
          <p className="feed-empty">Nenhuma arte registrada ainda. Seja o primeiro! 🎨</p>
        )}

        <div className="lb-list">
          {ranked.map((art, i) => {
            const rank = i + 1;
            const img = (art.imageUrl || '').startsWith('https://') ? art.imageUrl : '';
            const trophy = TROPHIES[rank];
            return (
              <div className={`lb-row ${trophy ? `lb-top lb-top-${rank}` : ''}`} key={art.id}>
                <div className="lb-rank">{trophy || rank}</div>
                <div className="lb-thumb">
                  {img ? <img src={img} alt={art.name || 'Arte'} loading="lazy" /> : <span>🎨</span>}
                </div>
                <div className="lb-info">
                  <span className="lb-name">{art.name}</span>
                  <span className="lb-artist">{art.artistName || 'Anônimo'}</span>
                </div>
                <div className="lb-likes">❤️ {art.likes}</div>
                <button
                  className="lb-locate"
                  onClick={() => onLocate && onLocate(art)}
                  title="Ver no mapa"
                  aria-label="Ver no mapa"
                >
                  📍
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
