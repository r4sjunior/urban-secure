import { useEffect, useRef, useState, forwardRef, useImperativeHandle, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletAuth } from '../context/WalletAuthContext';
import LikeButton from './LikeButton';
import CollectButton from './CollectButton';

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

const MapView = forwardRef(function MapView({ onLocationUpdate, arts = [], isLoading = false, onReady }, ref) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const markersByIdRef = useRef(new Map()); // art.id -> { marker, art }
  const [lightbox, setLightbox] = useState(null); // url da imagem ampliada
  const circleRef = useRef(null);
  const clusterGroupRef = useRef(null);
  const activeRef = useRef(false);
  const watchRef = useRef(null);
  const firstFix = useRef(true);
  const likeRootsRef = useRef(new Map()); // postId -> { root, artistWallet }
  const collectRootsRef = useRef(new Map()); // postId -> { root, art }
  const wallet = useWallet();
  const { isAuthenticated } = useWalletAuth();
  const isAuthRef = useRef(isAuthenticated);

  // Centraliza o mapa na arte e abre o popup. Usada pelo carrossel.
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

  // Quando wallet ou auth mudar, re-renderiza LikeButtons/CollectButtons já montados em popups abertos.
  useEffect(() => {
    likeRootsRef.current.forEach(({ root, artistWallet, postId }) => {
      root.render(<LikeButton postId={postId} artistWallet={artistWallet} wallet={wallet} isAuthenticated={isAuthenticated} />);
    });
    collectRootsRef.current.forEach(({ root, art }) => {
      root.render(<CollectButton art={art} wallet={wallet} isAuthenticated={isAuthenticated} />);
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

    const map = L.map(containerRef.current, { zoomControl: true, attributionControl: false })
      .setView([-5.79, -35.21], 13);
    mapRef.current = map;
    activeRef.current = true;

    // Tiles escuros (CARTO dark) para combinar com o tema
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 20,
    }).addTo(map);

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

    startGPS(L, map, userIcon);

    return () => {
      activeRef.current = false;
      stopGPS();
      if (clusterGroupRef.current) clusterGroupRef.current.clearLayers();
      map.remove();
      mapRef.current = markerRef.current = circleRef.current = clusterGroupRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current || !clusterGroupRef.current || typeof window === 'undefined') return;
    const L = require('leaflet');
    likeRootsRef.current.forEach(({ root }) => root.unmount());
    likeRootsRef.current.clear();
    collectRootsRef.current.forEach(({ root }) => root.unmount());
    collectRootsRef.current.clear();
    clusterGroupRef.current.clearLayers();
    markersByIdRef.current.clear();

    const COLORS = ['#FF3D71', '#FFD23F', '#3DFF88'];
    const network = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet';

    arts.forEach((art, i) => {
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

      const popup = `<div class="art-popup">
        ${safeImg ? `<img src="${safeImg}" class="art-popup-img" data-full="${safeImg}" onerror="this.style.display='none'"/>` : ''}
        <strong>${safeName}</strong>
        ${safeArtist ? `<em>por ${safeArtist}</em>` : ''}
        <span>${safeDesc}</span>
        <div class="art-popup-actions">
          <div class="art-popup-like" data-post-id="${escapeHtml(art.id)}" data-artist-wallet="${escapeHtml(art.artistWallet)}"></div>
          <div class="art-popup-collect" data-post-id="${escapeHtml(art.id)}"></div>
        </div>
        <a href="${solscanUrl}" target="_blank" rel="noreferrer" class="art-popup-link">🔗 Ver no Solscan</a>
      </div>`;

      const marker = L.marker([art.lat, art.lng], { icon })
        .bindPopup(popup, { maxWidth: 260, className: 'art-popup-wrap' });
      clusterGroupRef.current.addLayer(marker);
      if (art.id) markersByIdRef.current.set(art.id, { marker, art });
    });

    // Ao abrir um popup, conecta o clique na imagem para expandir (lightbox)
    // e monta o LikeButton React dentro do container do popup.
    mapRef.current.off('popupopen');
    mapRef.current.off('popupclose');
    mapRef.current.on('popupopen', (e) => {
      const el = e.popup?.getElement();
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

      const collectContainer = el?.querySelector('.art-popup-collect');
      if (collectContainer) {
        const postId = collectContainer.getAttribute('data-post-id');
        const art = postId ? markersByIdRef.current.get(postId)?.art : null;
        if (postId && art) {
          const root = createRoot(collectContainer);
          collectRootsRef.current.set(postId, { root, art });
          root.render(<CollectButton art={art} wallet={walletRef.current} isAuthenticated={isAuthRef.current} />);
        }
      }
    });
    mapRef.current.on('popupclose', (e) => {
      const el = e.popup?.getElement();
      const likeContainer = el?.querySelector('.art-popup-like');
      const postId = likeContainer?.getAttribute('data-post-id');
      if (postId && likeRootsRef.current.has(postId)) {
        const { root } = likeRootsRef.current.get(postId);
        // unmount assíncrono para evitar warning de unmount durante render
        setTimeout(() => root.unmount(), 0);
        likeRootsRef.current.delete(postId);
      }

      const collectContainer = el?.querySelector('.art-popup-collect');
      const collectPostId = collectContainer?.getAttribute('data-post-id');
      if (collectPostId && collectRootsRef.current.has(collectPostId)) {
        const { root } = collectRootsRef.current.get(collectPostId);
        setTimeout(() => root.unmount(), 0);
        collectRootsRef.current.delete(collectPostId);
      }
    });
  }, [arts]);

  function stopGPS() {
    if (watchRef.current !== null) { navigator.geolocation.clearWatch(watchRef.current); watchRef.current = null; }
  }

  function startGPS(Larg, mapArg, iconArg) {
    const L = Larg || require('leaflet');
    const map = mapArg || mapRef.current;
    const icon = iconArg || L.divIcon({ className:'', html:'<div class="me-marker"><div class="me-dot"></div></div>', iconSize:[24,24], iconAnchor:[12,12] });
    if (!map || !navigator.geolocation) { onLocationUpdate({ error: 'GPS não disponível.' }); return; }
    stopGPS();

    function onPos(pos) {
      if (!activeRef.current || !mapRef.current) return;
      const m = mapRef.current;
      const lat = pos.coords.latitude, lng = pos.coords.longitude, acc = Math.round(pos.coords.accuracy);
      try {
        if (markerRef.current) markerRef.current.setLatLng([lat,lng]);
        else markerRef.current = L.marker([lat,lng], { icon }).addTo(m);
        if (circleRef.current) circleRef.current.setLatLng([lat,lng]).setRadius(acc);
        else circleRef.current = L.circle([lat,lng], { radius:acc, color:'#3DFF88', fillColor:'#3DFF88', fillOpacity:0.08, weight:1 }).addTo(m);
        if (firstFix.current) { m.setView([lat,lng], 17); firstFix.current = false; }
      } catch {}
      onLocationUpdate({ lat, lng, acc, fonte:'GPS' });
    }
    function onErr(err) {
      if (!activeRef.current) return;
      if (err.code === 3) {
        watchRef.current = navigator.geolocation.watchPosition(onPos,
          () => onLocationUpdate({ error:'GPS indisponível.' }),
          { enableHighAccuracy:false, maximumAge:10000, timeout:30000 });
        return;
      }
      onLocationUpdate({ error: err.code===1 ? 'Permissão de GPS negada.' : 'GPS indisponível.' });
    }
    watchRef.current = navigator.geolocation.watchPosition(onPos, onErr, { enableHighAccuracy:true, maximumAge:0, timeout:30000 });
  }

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
      <button className="gps-fab" onClick={() => startGPS()} title="Meu GPS">📍</button>

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
