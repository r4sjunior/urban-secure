/**
 * components/ArtCarousel.jsx
 * Faixa horizontal no topo do mapa com as artes registradas, em MOVIMENTO.
 * Desliza sozinho em loop infinito (marquee) e PAUSA ao passar o mouse / tocar.
 * Cada card: imagem + nome do artista. Ao clicar → onSelect(art).
 */
import { forwardRef } from 'react';

const ArtCarousel = forwardRef(function ArtCarousel({ arts = [], onSelect }, ref) {
  if (!arts || arts.length === 0) return null;

  // Loop contínuo só faz sentido com algumas artes. Com poucas, fica estático.
  const animate = arts.length >= 3;

  // Para o loop perfeito, renderizamos a lista DUPLICADA. Quando a animação
  // percorre exatamente a largura da 1ª cópia, o ponto visual é idêntico ao
  // início — então o "reset" é invisível.
  const sequence = animate ? [...arts, ...arts] : arts;

  // Velocidade proporcional à quantidade (mais artes = mais tempo, ritmo constante)
  const duration = Math.max(18, arts.length * 4); // ~4s por arte, mínimo 18s

  const Card = (art, i) => {
    const img = (art.imageUrl || '').startsWith('https://') ? art.imageUrl : '';
    const artist = art.artistName || 'Anônimo';
    return (
      <button
        key={`${art.id || 'a'}-${i}`}
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
  };

  return (
    <div className="carousel" ref={ref}>
      <div
        className={`carousel-track${animate ? ' carousel-animate' : ''}`}
        style={animate ? { animationDuration: `${duration}s` } : undefined}
      >
        {sequence.map((art, i) => Card(art, i))}
      </div>
    </div>
  );
});

export default ArtCarousel;
