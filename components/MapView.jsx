import { useEffect, useRef, useState } from 'react';

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

export default function MapView({ onLocationUpdate, arts = [], isLoading = false }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const circleRef = useRef(null);
  const artMarkersRef = useRef([]);
  const activeRef = useRef(false);
  const watchRef = useRef(null);
  const firstFix = useRef(true);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const L = require('leaflet');
    require('leaflet/dist/leaflet.css');

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

    startGPS(L, map, userIcon);

    return () => {
      activeRef.current = false;
      stopGPS();
      artMarkersRef.current.forEach(m => m.remove());
      map.remove();
      mapRef.current = markerRef.current = circleRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current || typeof window === 'undefined') return;
    const L = require('leaflet');
    artMarkersRef.current.forEach(m => m.remove());
    artMarkersRef.current = [];

    const COLORS = ['#FF3D71', '#FFD23F', '#3DFF88'];

    arts.forEach((art, i) => {
      const color = COLORS[i % COLORS.length];
      const icon = L.divIcon({
        className: '',
        html: `<div class="art-pin" style="--pc:${color}">
          <div class="art-pin-body"><span>🎨</span></div>
          <div class="art-pin-shadow"></div>
        </div>`,
        iconSize: [40,48], iconAnchor: [20,46], popupAnchor: [0,-44],
      });

      const safeImg = (art.imageUrl||'').startsWith('https://') ? escapeHtml(art.imageUrl) : '';
      const safeName = escapeHtml(art.name);
      const safeDesc = escapeHtml(art.description);
      const safeArtist = escapeHtml(art.artistName || '');

      const popup = `<div class="art-popup">
        ${safeImg ? `<img src="${safeImg}" onerror="this.style.display='none'"/>` : ''}
        <strong>${safeName}</strong>
        ${safeArtist ? `<em>por ${safeArtist}</em>` : ''}
        <span>${safeDesc}</span>
      </div>`;

      const marker = L.marker([art.lat, art.lng], { icon })
        .addTo(mapRef.current).bindPopup(popup, { maxWidth: 220, className: 'art-popup-wrap' });
      artMarkersRef.current.push(marker);
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
    </div>
  );
}
