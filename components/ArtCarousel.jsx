/**
 * components/ArtCarousel.jsx
 * Faixa horizontal no topo do mapa mostrando as artes registradas.
 * Cada card: imagem + nome do artista. Ao clicar → onSelect(art),
 * que centraliza o mapa naquela arte e abre o popup.
 */
import { useRef } from 'react';

export default function ArtCarousel({ arts = [], onSelect }) {
  const trackRef = useRef(null);

  if (!arts || arts.length === 0) return null;

  return (
    <div className="carousel">
      <div className="carousel-track" ref={trackRef}>
        {arts.map((art, i) => {
          const img = (art.imageUrl || '').startsWith('https://') ? art.imageUrl : '';
          const artist = art.artistName || 'Anônimo';
          return (
            <button
              key={art.id || i}
              className="carousel-card"
              onClick={() => onSelect && onSelect(art)}
              title={art.name || ''}
            >
              <div className="carousel-thumb">
                {img
                  ? <img src={img} alt={art.name || 'Arte'} loading="lazy"
                         onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.parentNode.innerHTML = '<span>🎨</span>'; }} />
                  : <span>🎨</span>}
              </div>
              <div className="carousel-meta">
                <span className="carousel-artist">{artist}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
