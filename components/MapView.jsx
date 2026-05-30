import { useEffect, useRef, useState } from 'react';

// ─────────────────────────────────────────────────────────────
// getMockArts — dados de exemplo seguindo a interface UrbanArt
// @returns {import('../types/art').UrbanArt[]}
// ─────────────────────────────────────────────────────────────
export function getMockArts() {
  return [
    {
      id:           'mock-nft-001',
      name:         'Peixe-Boi Voador',
      description:  'Mural em homenagem ao peixe-boi da costa potiguar.',
      lat:          -5.7950,
      lng:          -35.2110,
      imageUrl:     'https://placehold.co/120x120/1a3a5c/ffffff?text=Arte+1',
      artistWallet: '7xKfVQkQpzx9dMUf3e8vAT6mRjYNpLhCbWqXsZt2nR4o',
      timestamp:    1716825600000,
    },
    {
      id:           'mock-nft-002',
      name:         'Raízes do Nordeste',
      description:  'Grafite sobre a cultura e resistência nordestina.',
      lat:          -5.8020,
      lng:          -35.2050,
      imageUrl:     'https://placehold.co/120x120/1a6b3c/ffffff?text=Arte+2',
      artistWallet: '3nP8vLqWm1ZyXdT5kR7sE2oKcNjFhUbYgA4iM9wQtVxp',
      timestamp:    1716912000000,
    },
    {
      id:           'mock-nft-003',
      name:         'Sol de Agosto',
      description:  'Painel abstrato inspirado no calor do sertão.',
      lat:          -5.7880,
      lng:          -35.2180,
      imageUrl:     'https://placehold.co/120x120/b85c00/ffffff?text=Arte+3',
      artistWallet: 'AkP2nLqWm7ZyXdT9kR4sE6oKcNjFhUbYgB8iM3wQtVxz',
      timestamp:    1716998400000,
    },
  ];
}

// ─────────────────────────────────────────────────────────────
// MapView
//
// Props:
//   onLocationUpdate  (pos) => void   — callback com posição do usuário
//   arts              UrbanArt[]      — obras a renderizar no mapa
// ─────────────────────────────────────────────────────────────

/**
 * @param {{ onLocationUpdate: Function, arts?: import('../types/art').UrbanArt[] }} props
 */
export default function MapView({ onLocationUpdate, arts = [], isLoading = false }) {
  const containerRef  = useRef(null);
  const mapRef        = useRef(null);
  const markerRef     = useRef(null);   // marcador de posição do usuário
  const circleRef     = useRef(null);
  const artMarkersRef = useRef([]);     // marcadores das obras
  const activeRef     = useRef(false);
  const watchRef      = useRef(null);
  const [modo, setModo] = useState('aguardando');

  // ── Inicializa o mapa ───────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const L = require('leaflet');
    require('leaflet/dist/leaflet.css');

    // Ícone padrão (posição do usuário)
    const iconeUsuario = L.icon({
      iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
      iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
      shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41],
    });

    const map = L.map(containerRef.current).setView([-5.79, -35.21], 14);
    mapRef.current = map;
    activeRef.current = true;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
    }).addTo(map);

    // Toque/clique = posição manual arrastável
    map.on('click', (e) => {
      if (!activeRef.current) return;
      const { lat, lng } = e.latlng;
      colocarMarcadorUsuario(L, map, iconeUsuario, lat, lng, true);
      setModo('manual');
      onLocationUpdate({ lat, lng, acc: 0, fonte: 'Manual' });
    });

    iniciarGPS(L, map, iconeUsuario);

    return () => {
      activeRef.current = false;
      pararGPS();
      artMarkersRef.current.forEach(m => m.remove());
      artMarkersRef.current = [];
      map.remove();
      mapRef.current = markerRef.current = circleRef.current = null;
    };
  }, []);

  // ── Renderiza marcadores das obras sempre que `arts` mudar ──
  useEffect(() => {
    if (!mapRef.current || typeof window === 'undefined') return;

    const L = require('leaflet');

    // Remove marcadores antigos
    artMarkersRef.current.forEach(m => m.remove());
    artMarkersRef.current = [];

    // Ícone pin estilo arte urbana com cores Rasta
    // Cada obra recebe uma cor diferente ciclando pelo array
    const RASTA_COLORS = [
      { bg: '#D32F2F', label: 'R' },  // vermelho
      { bg: '#F9A825', label: 'Y' },  // amarelo
      { bg: '#2E7D32', label: 'G' },  // verde
    ];

    const iconeArte = (index) => {
      const color = RASTA_COLORS[index % RASTA_COLORS.length];
      return L.divIcon({
        className: '',
        html: `
          <div class="art-marker">
            <div class="art-marker-inner" style="background:${color.bg};">
              <span>🎨</span>
            </div>
          </div>`,
        iconSize:    [38, 38],
        iconAnchor:  [19, 38],
        popupAnchor: [0, -40],
      });
    };

    arts.forEach((art, index) => {
      const popup = `
        <div style="font-family:Arial,sans-serif; min-width:160px; max-width:200px;">
          <img
            src="${art.imageUrl}"
            alt="${art.name}"
            style="width:100%; height:100px; object-fit:cover; border-radius:6px; margin-bottom:6px; display:block;"
            onerror="this.style.display='none'"
          />
          <strong style="font-size:13px; color:#1a3a5c; display:block; margin-bottom:2px;">
            ${art.name}
          </strong>
          <span style="font-size:11px; color:#555; display:block; margin-bottom:4px;">
            ${art.description}
          </span>
          <span style="font-size:10px; color:#888;">
            ${new Date(art.timestamp).toLocaleDateString('pt-BR')}
          </span>
        </div>
      `;

      const marker = L.marker([art.lat, art.lng], { icon: iconeArte(index) })
        .addTo(mapRef.current)
        .bindPopup(popup, { maxWidth: 220 });

      artMarkersRef.current.push(marker);
    });
  }, [arts]);

  // ── GPS ─────────────────────────────────────────────────────
  function pararGPS() {
    if (watchRef.current !== null) {
      navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
    }
  }

  function colocarMarcadorUsuario(L, map, icone, lat, lng, arrastavel = false) {
    if (markerRef.current) {
      markerRef.current.setLatLng([lat, lng]);
    } else {
      markerRef.current = L.marker([lat, lng], { icon: icone, draggable: arrastavel })
        .addTo(map)
        .bindPopup(arrastavel ? '📍 Posição manual — arraste para ajustar' : '📍 Sua localização')
        .openPopup();

      if (arrastavel) {
        markerRef.current.on('dragend', () => {
          const p = markerRef.current.getLatLng();
          onLocationUpdate({ lat: p.lat, lng: p.lng, acc: 0, fonte: 'Manual' });
        });
      }
    }
  }

  function iniciarGPS(Larg, mapArg, iconeArg) {
    const L     = Larg    || require('leaflet');
    const map   = mapArg  || mapRef.current;
    const icone = iconeArg || L.icon({
      iconUrl:  'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
      shadowUrl:'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41],
    });
    if (!map || !navigator.geolocation) return;

    pararGPS();
    setModo('aguardando');

    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => onPosicao(pos, L, map, icone, 'GPS'),
      (err) => {
        if (err.code === 3 || err.code === 2) {
          watchRef.current = navigator.geolocation.watchPosition(
            (pos) => onPosicao(pos, L, map, icone, 'Rede'),
            (err2) => onErro(err2),
            { enableHighAccuracy: false, maximumAge: 10000, timeout: 30000 }
          );
        } else {
          onErro(err);
        }
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 60000 }
    );
  }

  function onPosicao(pos, L, map, icone, fonte) {
    if (!activeRef.current || !mapRef.current) return;
    const m   = mapRef.current;
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    const acc = Math.round(pos.coords.accuracy);

    try {
      colocarMarcadorUsuario(L, m, icone, lat, lng, false);

      if (circleRef.current) {
        circleRef.current.setLatLng([lat, lng]).setRadius(acc);
      } else {
        circleRef.current = L.circle([lat, lng], {
          radius: acc, color: '#00c853', fillColor: '#00c853',
          fillOpacity: 0.10, weight: 1.5,
        }).addTo(m);
      }

      if (modo === 'aguardando') m.setView([lat, lng], 17);
    } catch (_) { return; }

    setModo('gps');
    onLocationUpdate({ lat, lng, acc, fonte });
  }

  function onErro(err) {
    if (!activeRef.current) return;
    const msgs = {
      1: 'Permissão negada. Toque no mapa para marcar sua posição.',
      2: 'Sinal GPS fraco. Toque no mapa para marcar sua posição.',
      3: 'GPS indisponível. Toque no mapa para marcar sua posição.',
    };
    setModo('erro');
    onLocationUpdate({ error: msgs[err.code] || 'Erro GPS. Toque no mapa.' });
  }

  // ── Render ──────────────────────────────────────────────────
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {/* Contador de obras no mapa */}
      {arts.length > 0 && (
        <div style={{
          position: 'absolute', top: 10, right: 10, zIndex: 9999,
          background: 'rgba(0,200,83,0.9)', color: '#000',
          padding: '5px 12px', borderRadius: 16, fontSize: 12, fontWeight: 700,
        }}>
          🎨 {arts.length} obra{arts.length !== 1 ? 's' : ''} no mapa
        </div>
      )}

      {/* Dica de toque */}
      {(modo === 'aguardando' || modo === 'erro') && (
        <div style={{
          position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)',
          zIndex: 9999, background: 'rgba(0,0,0,0.78)', color: '#fff',
          padding: '7px 16px', borderRadius: 20, fontSize: 12,
          pointerEvents: 'none', whiteSpace: 'nowrap',
        }}>
          {modo === 'erro'
            ? '👆 Toque no mapa para marcar sua posição'
            : '📡 Buscando GPS… aguarde ou toque no mapa'}
        </div>
      )}

      {/* Overlay de carregamento */}
      {isLoading && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 9998,
          background: 'rgba(0,0,0,0.55)',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 12,
        }}>
          <div style={{
            width: 40, height: 40, border: '4px solid #00c853',
            borderTopColor: 'transparent', borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }} />
          <span style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>
            Carregando artes da Solana…
          </span>
        </div>
      )}

      {/* Botão reativar GPS */}
      <button
        onClick={() => iniciarGPS()}
        title="Reativar GPS"
        style={{
          position: 'absolute', bottom: 80, right: 10, zIndex: 9999,
          background: modo === 'gps' ? '#00c853' : '#111',
          color: '#fff', border: '2px solid #333',
          borderRadius: '50%', width: 42, height: 42,
          fontSize: 18, cursor: 'pointer',
          boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >📍</button>
    </div>
  );
}
