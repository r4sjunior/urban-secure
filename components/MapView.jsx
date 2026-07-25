import { useEffect, useRef, useState, forwardRef, useImperativeHandle, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletAuth } from '../context/WalletAuthContext';
import { useTheme } from '../context/ThemeContext';
import { useGeo } from '../context/GeoContext';
import LikeButton from './LikeButton';
import { LocateFixed } from 'lucide-react';
import { googleMapsUrl } from '../lib/googleMaps';

/** Variantes do mesmo basemap — trocadas conforme o tema ativo. */
const TILES = {
  dark:  'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
};

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

const MapView = forwardRef(function MapView({ onLocationUpdate, arts = [], isLoading = false, onReady, onPopupToggle }, ref) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const markersByIdRef = useRef(new Map()); // art.id -> { marker, art }
  const [lightbox, setLightbox] = useState(null); // url da imagem ampliada

  // O mapa já existe? Precisa ser ESTADO, não só o ref.
  //
  // O rastreio de GPS vive no GeoProvider, que monta antes do mapa — e com
  // `maximumAge` o sistema costuma devolver a primeira posição na hora, do
  // cache. Ou seja: a posição normalmente chega ANTES do Leaflet terminar de
  // carregar. Mutar `mapRef.current` não re-renderiza nada, então o efeito
  // que desenha a posição saía pelo `return` e nunca era reexecutado: o
  // usuário ficava sem o ponto azul e sem coordenada para registrar arte,
  // até o watch emitir uma leitura nova — o que, com o aparelho parado, pode
  // demorar muito ou não acontecer.
  const [mapaPronto, setMapaPronto] = useState(false);
  const circleRef = useRef(null);
  const clusterGroupRef = useRef(null);
  const activeRef = useRef(false);
  const firstFix = useRef(true);
  const likeRootsRef = useRef(new Map()); // postId -> { root, artistWallet }
  const wallet = useWallet();
  const { isAuthenticated } = useWalletAuth();
  const { theme } = useTheme();
  const { posicao, reiniciar: reiniciarGps } = useGeo();
  const tileRef = useRef(null);
  const isAuthRef = useRef(isAuthenticated);
  const onPopupToggleRef = useRef(onPopupToggle);
  useEffect(() => { onPopupToggleRef.current = onPopupToggle; }, [onPopupToggle]);

  // Centraliza o popup aberto exatamente no meio da área visível do mapa,
  // deslocando o mapa (não o popup) — funciona com qualquer tamanho de card.
  const centerPopupElement = useCallback((popupEl) => {
    const map = mapRef.current;
    const container = containerRef.current;
    if (!map || !container || !popupEl) return;
    const mapRect = container.getBoundingClientRect();
    const popRect = popupEl.getBoundingClientRect();
    const dx = (popRect.left + popRect.width / 2) - (mapRect.left + mapRect.width / 2);
    const dy = (popRect.top + popRect.height / 2) - (mapRect.top + mapRect.height / 2);
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) map.panBy([dx, dy], { animate: true, duration: 0.3 });
  }, []);

  // Centraliza o mapa na arte e abre o popup. Usada pelo feed/leaderboard.
  const focusArt = useCallback((art) => {
    if (!art || !mapRef.current) return;
    const entry = art.id ? markersByIdRef.current.get(art.id) : null;
    const lat = parseFloat(art.lat), lng = parseFloat(art.lng);
    if (isNaN(lat) || isNaN(lng)) return;
    mapRef.current.flyTo([lat, lng], 17, { duration: 1.1 });
    if (entry?.marker) {
      setTimeout(() => entry.marker.openPopup(), 1150);
    }
  }, []);

  // Expõe focusArt de DUAS formas (uma delas sempre funciona com next/dynamic):
  // 1) via ref (useImperativeHandle) — caso o ref seja repassado
  // 2) via callback onReady — funciona sempre, mesmo com dynamic ssr:false
  useImperativeHandle(ref, () => ({ focusArt }), [focusArt]);
  useEffect(() => {
    if (typeof onReady === 'function') onReady({ focusArt });
  }, [onReady, focusArt]);
  const walletRef = useRef(wallet);

  // Mantém refs sempre atualizados (evita closure stale nos callbacks do Leaflet)
  useEffect(() => { walletRef.current = wallet; }, [wallet]);
  useEffect(() => { isAuthRef.current = isAuthenticated; }, [isAuthenticated]);

  // Quando wallet ou auth mudar, re-renderiza os LikeButtons já montados em popups abertos.
  useEffect(() => {
    likeRootsRef.current.forEach(({ root, artistWallet, postId }) => {
      root.render(<LikeButton postId={postId} artistWallet={artistWallet} wallet={wallet} isAuthenticated={isAuthenticated} />);
    });
  }, [wallet, wallet.connected, wallet.publicKey, isAuthenticated]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const L = require('leaflet');
    require('leaflet/dist/leaflet.css');
    require('leaflet.markercluster');
    require('leaflet.markercluster/dist/MarkerCluster.css');
    require('leaflet.markercluster/dist/MarkerCluster.Default.css');

    const userIcon = L.divIcon({
      className: '',
      html: `<div class="me-marker"><div class="me-pulse"></div><div class="me-dot"></div></div>`,
      iconSize: [24,24], iconAnchor: [12,12],
    });

    // O zoom padrão do Leaflet nasce em 'topleft', onde a nossa topbar
    // flutuante o cobre por completo. Movido para a direita, ele forma um
    // grupo vertical com o botão de GPS, longe da busca e do dock.
    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: false,
    })
      .setView([-5.79, -35.21], 13);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    mapRef.current = map;
    activeRef.current = true;
    // Avisa o efeito da posição de que já dá para desenhar (ver `mapaPronto`).
    setMapaPronto(true);

    // O CARTO publica variantes clara e escura do mesmo mapa. Trocar a
    // CAMADA é muito melhor que inverter a escura por filtro CSS: o invert
    // produz um cinza lavado, sem hierarquia entre via, quadra e água, e o
    // mapa deixa de ser legível justamente no tema em que precisa de mais
    // contraste. A camada é substituída no efeito de tema, logo abaixo.
    tileRef.current = L.tileLayer(TILES.dark, { maxZoom: 20 }).addTo(map);

    // Agrupa pinos próximos numa bolha com contagem — ao afastar o zoom os
    // pinos não ficam mais se sobrepondo de forma bagunçada "fora do lugar".
    // Clicar/zoom expande revelando os pinos exatos nas coordenadas reais.
    clusterGroupRef.current = L.markerClusterGroup({
      maxClusterRadius: 50,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      iconCreateFunction(cluster) {
        const count = cluster.getChildCount();
        const size = count < 10 ? 40 : count < 50 ? 48 : 56;
        return L.divIcon({
          html: `<div class="marker-cluster-custom" style="width:${size}px;height:${size}px"><span>${count}</span></div>`,
          className: '',
          iconSize: [size, size],
        });
      },
    }).addTo(map);

    // O rastreio é global (context/GeoContext.jsx) — o mapa só desenha o
    // que ele reporta. Antes o watch vivia aqui e morria a cada navegação.

    return () => {
      activeRef.current = false;
      if (clusterGroupRef.current) clusterGroupRef.current.clearLayers();
      map.remove();
      mapRef.current = markerRef.current = circleRef.current = clusterGroupRef.current = null;
      setMapaPronto(false);
      // O próximo mapa precisa centralizar no primeiro fix de novo — senão,
      // ao voltar do álbum, ele nasce em Natal e ignora onde o usuário está.
      firstFix.current = true;
    };
  }, []);

  // Troca o basemap ao mudar de tema. setUrl() reaproveita a camada, então
  // os tiles já em cache aparecem na hora, sem piscar o mapa inteiro.
  useEffect(() => {
    if (tileRef.current) tileRef.current.setUrl(TILES[theme] || TILES.dark);
  }, [theme]);

  useEffect(() => {
    if (!mapRef.current || !clusterGroupRef.current || typeof window === 'undefined') return;
    const L = require('leaflet');

    // RECONCILIA em vez de recriar.
    //
    // Antes, cada mudança em `arts` limpava o cluster inteiro e remontava
    // todos os pinos. Numa busca de fundo — que acontece ao abrir o app e ao
    // registrar uma arte — os marcadores sumiam e voltavam, e quem estivesse
    // arrastando o mapa via tudo piscar no meio do gesto. Um popup aberto
    // era fechado à força junto.
    //
    // Agora só entram os pinos novos e só saem os que deixaram de existir.
    // Quem já está no mapa fica intacto, com seu popup e sua posição.
    const idsAtuais = new Set(arts.map(a => a.id).filter(Boolean));

    for (const [id, entry] of markersByIdRef.current) {
      if (idsAtuais.has(id)) continue;
      try { clusterGroupRef.current.removeLayer(entry.marker); } catch {}
      markersByIdRef.current.delete(id);

      const root = likeRootsRef.current.get(id);
      if (root) {
        // Desmonte assíncrono: síncrono aqui dispara aviso do React por
        // desmontar durante o render de outra árvore.
        setTimeout(() => { try { root.root.unmount(); } catch {} }, 0);
        likeRootsRef.current.delete(id);
      }
    }

    const COLORS = ['#FF3D71', '#FFD23F', '#3DFF88'];
    const network = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet';

    arts.forEach((art, i) => {
      // Já está no mapa: nada a fazer.
      if (art.id && markersByIdRef.current.has(art.id)) return;
      const color = COLORS[i % COLORS.length];
      const safeImg = (art.imageUrl||'').startsWith('https://') ? escapeHtml(art.imageUrl) : '';

      // Pino com a MINIATURA da arte dentro (ou 🎨 se sem imagem)
      const icon = L.divIcon({
        className: '',
        html: `<div class="art-pin" style="--pc:${color}">
          <div class="art-pin-body">
            ${safeImg ? `<img src="${safeImg}" class="art-pin-img" onerror="this.parentNode.innerHTML='<span>🎨</span>'"/>` : '<span>🎨</span>'}
          </div>
          <div class="art-pin-shadow"></div>
        </div>`,
        iconSize: [46,56], iconAnchor: [23,54], popupAnchor: [0,-52],
      });

      const safeName = escapeHtml(art.name);
      const safeDesc = escapeHtml(art.description);
      const safeArtist = escapeHtml(art.artistName || '');
      const solscanUrl = `https://solscan.io/token/${escapeHtml(art.id)}${network==='devnet'?'?cluster=devnet':''}`;

      // Leva a pessoa até a obra de verdade — no celular abre o app nativo.
      const mapsUrl = googleMapsUrl(art.lat, art.lng);
      const perfilUrl = art.artistWallet ? `/perfil/${encodeURIComponent(art.artistWallet)}` : '';

      const popup = `<div class="art-popup">
        ${safeImg ? `<img src="${safeImg}" class="art-popup-img" data-full="${safeImg}" onerror="this.style.display='none'"/>` : ''}
        <strong>${safeName}</strong>
        ${safeArtist
          ? perfilUrl
            ? `<em>por <a href="${perfilUrl}" class="art-popup-artist">${safeArtist}</a></em>`
            : `<em>por ${safeArtist}</em>`
          : ''}
        <span>${safeDesc}</span>
        <div class="art-popup-actions">
          <div class="art-popup-like" data-post-id="${escapeHtml(art.id)}" data-artist-wallet="${escapeHtml(art.artistWallet)}"></div>
        </div>
        ${mapsUrl ? `<a href="${mapsUrl}" target="_blank" rel="noreferrer" class="art-popup-link art-popup-maps">🧭 Como chegar</a>` : ''}
        <a href="${solscanUrl}" target="_blank" rel="noreferrer" class="art-popup-link">🔗 Ver no Solscan</a>
      </div>`;

      const marker = L.marker([art.lat, art.lng], { icon })
        .bindPopup(popup, { maxWidth: 260, className: 'art-popup-wrap', autoPan: false });
      clusterGroupRef.current.addLayer(marker);
      if (art.id) markersByIdRef.current.set(art.id, { marker, art });
    });

    // Ao abrir um popup, conecta o clique na imagem para expandir (lightbox)
    // e monta o LikeButton React dentro do container do popup.
    mapRef.current.off('popupopen');
    mapRef.current.off('popupclose');
    mapRef.current.on('popupopen', (e) => {
      const el = e.popup?.getElement();
      onPopupToggleRef.current?.(true);
      // Espera o popup ser posicionado pelo Leaflet antes de medir e centralizar.
      setTimeout(() => centerPopupElement(el), 20);
      const img = el?.querySelector('.art-popup-img');
      if (img) {
        img.style.cursor = 'zoom-in';
        img.onclick = () => setLightbox(img.getAttribute('data-full'));
      }

      const likeContainer = el?.querySelector('.art-popup-like');
      if (likeContainer) {
        const postId = likeContainer.getAttribute('data-post-id');
        const artistWallet = likeContainer.getAttribute('data-artist-wallet');
        if (postId && artistWallet) {
          const root = createRoot(likeContainer);
          likeRootsRef.current.set(postId, { root, artistWallet, postId });
          root.render(<LikeButton postId={postId} artistWallet={artistWallet} wallet={walletRef.current} isAuthenticated={isAuthRef.current} />);
        }
      }
    });

    mapRef.current.on('popupclose', (e) => {
      onPopupToggleRef.current?.(false);
      const el = e.popup?.getElement();
      const likeContainer = el?.querySelector('.art-popup-like');
      const postId = likeContainer?.getAttribute('data-post-id');
      if (postId && likeRootsRef.current.has(postId)) {
        const { root } = likeRootsRef.current.get(postId);
        // unmount assíncrono para evitar warning de unmount durante render
        setTimeout(() => root.unmount(), 0);
        likeRootsRef.current.delete(postId);
      }

    });
  }, [arts]);

  /**
   * Desenha a posição do usuário. Roda quando o contexto reporta algo novo.
   */
  useEffect(() => {
    // O erro é reportado mesmo sem mapa: a barra de status precisa dizer
    // "permissão negada" antes de o Leaflet terminar de carregar.
    if (posicao?.error) { onLocationUpdate({ error: posicao.error }); return; }
    if (!posicao || !mapaPronto || !mapRef.current) return;

    const L = require('leaflet');
    const m = mapRef.current;
    const { lat, lng, acc } = posicao;

    try {
      if (markerRef.current) {
        markerRef.current.setLatLng([lat, lng]);
      } else {
        const icon = L.divIcon({
          className: '',
          html: '<div class="me-marker"><div class="me-pulse"></div><div class="me-dot"></div></div>',
          iconSize: [24, 24], iconAnchor: [12, 12],
        });
        markerRef.current = L.marker([lat, lng], { icon }).addTo(m);
      }

      if (circleRef.current) circleRef.current.setLatLng([lat, lng]).setRadius(acc);
      else circleRef.current = L.circle([lat, lng], {
        radius: acc, color: '#3DFF88', fillColor: '#3DFF88', fillOpacity: 0.08, weight: 1,
      }).addTo(m);

      // Só centraliza no PRIMEIRO fix. Depois disso o mapa é do usuário —
      // recentralizar a cada atualização puxaria a tela de volta enquanto
      // ele navega, que é exatamente o tipo de falha que ele relatou.
      if (firstFix.current) { m.setView([lat, lng], 17); firstFix.current = false; }
    } catch {}

    onLocationUpdate({ lat, lng, acc, fonte: 'GPS' });
  }, [posicao, onLocationUpdate, mapaPronto]);

  /**
   * Leva o mapa até a posição do usuário.
   *
   * Não reinicia o rastreio — só move a câmera. Reiniciar reacenderia o
   * sensor e traria de volta o "pedindo GPS toda hora". Se ainda não houver
   * posição, aí sim pede uma releitura ao contexto.
   */
  const centralizarNoUsuario = useCallback(() => {
    const m = mapRef.current;
    if (!m) return;

    if (markerRef.current) {
      m.setView(markerRef.current.getLatLng(), Math.max(m.getZoom(), 16), { animate: true });
      return;
    }
    reiniciarGps();
  }, [reiniciarGps]);

  return (
    <div style={{ width:'100%', height:'100%', position:'relative' }}>
      <div ref={containerRef} style={{ width:'100%', height:'100%' }} />
      {arts.length > 0 && (
        <div className="map-counter">🎨 {arts.length} obra{arts.length!==1?'s':''}</div>
      )}
      {isLoading && (
        <div className="map-loading">
          <div className="map-spinner" />
          <span>Carregando artes…</span>
        </div>
      )}
      <button className="gps-fab" onClick={centralizarNoUsuario} title="Centralizar no meu GPS" aria-label="Centralizar no meu GPS">
        <LocateFixed className="lucide" />
      </button>

      {/* Lightbox — imagem ampliada ao clicar na miniatura */}
      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="Arte" onClick={(e) => e.stopPropagation()} />
          <button className="lightbox-close" onClick={() => setLightbox(null)}>✕</button>
        </div>
      )}
    </div>
  );
});

export default MapView;
