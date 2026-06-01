import { useEffect, useRef, useState } from 'react';

export default function MapView({ onLocationUpdate, arts = [], isLoading = false }) {
  const containerRef  = useRef(null);
  const mapRef        = useRef(null);
  const markerRef     = useRef(null);
  const circleRef     = useRef(null);
  const artMarkersRef = useRef([]);
  const activeRef     = useRef(false);
  const watchRef      = useRef(null);
  const firstFix      = useRef(true);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const L = require('leaflet');
    require('leaflet/dist/leaflet.css');

    const userIcon = L.icon({
      iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
      iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
      shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      iconSize: [25,41], iconAnchor: [12,41], popupAnchor: [1,-34], shadowSize: [41,41],
    });

    const map = L.map(containerRef.current, { zoomControl: true })
      .setView([-5.79, -35.21], 13);
    mapRef.current = map;
    activeRef.current = true;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
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

  // Renderiza marcadores das artes
  useEffect(() => {
    if (!mapRef.current || typeof window === 'undefined') return;
    const L = require('leaflet');

    artMarkersRef.current.forEach(m => m.remove());
    artMarkersRef.current = [];

    const COLORS = ['#D32F2F', '#F9A825', '#2E7D32'];

    arts.forEach((art, i) => {
      const color = COLORS[i % COLORS.length];
      const icon  = L.divIcon({
        className: '',
        html: `<div style="
          width:36px;height:36px;border-radius:50% 50% 50% 4px;
          background:${color};border:2.5px solid rgba(255,255,255,0.4);
          display:flex;align-items:center;justify-content:center;
          font-size:17px;transform:rotate(-45deg);
          box-shadow:0 3px 8px rgba(0,0,0,0.5);">
          <span style="transform:rotate(45deg)">🎨</span>
        </div>`,
        iconSize: [36,36], iconAnchor: [18,36], popupAnchor: [0,-38],
      });

      const popup = `
        <div style="font-family:Arial,sans-serif;min-width:160px;max-width:200px;">
          ${art.imageUrl ? `<img src="${art.imageUrl}" style="width:100%;height:90px;object-fit:cover;border-radius:6px;margin-bottom:6px;display:block;" onerror="this.style.display='none'"/>` : ''}
          <strong style="font-size:13px;color:#1a3a5c;display:block;margin-bottom:2px;">${art.name}</strong>
          <span style="font-size:11px;color:#555;display:block;">${art.description}</span>
        </div>`;

      const marker = L.marker([art.lat, art.lng], { icon })
        .addTo(mapRef.current)
        .bindPopup(popup, { maxWidth: 220 });

      artMarkersRef.current.push(marker);
    });
  }, [arts]);

  function stopGPS() {
    if (watchRef.current !== null) {
      navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
    }
  }

  function startGPS(Larg, mapArg, iconArg) {
    const L    = Larg   || require('leaflet');
    const map  = mapArg || mapRef.current;
    const icon = iconArg;
    if (!map || !navigator.geolocation) {
      onLocationUpdate({ error: 'GPS não disponível.' });
      return;
    }

    stopGPS();

    function onPos(pos) {
      if (!activeRef.current || !mapRef.current) return;
      const m   = mapRef.current;
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const acc = Math.round(pos.coords.accuracy);

      try {
        if (markerRef.current) {
          markerRef.current.setLatLng([lat, lng]);
        } else {
          markerRef.current = L.marker([lat, lng], { icon })
            .addTo(m)
            .bindPopup('📍 Você está aqui')
            .openPopup();
        }

        if (circleRef.current) {
          circleRef.current.setLatLng([lat, lng]).setRadius(acc);
        } else {
          circleRef.current = L.circle([lat, lng], {
            radius: acc, color: '#00c853', fillColor: '#00c853',
            fillOpacity: 0.10, weight: 1.5,
          }).addTo(m);
        }

        // Centraliza na primeira leitura — qualquer precisão
        if (firstFix.current) {
          m.setView([lat, lng], 17);
          firstFix.current = false;
        }
      } catch (_) { return; }

      onLocationUpdate({ lat, lng, acc, fonte: 'GPS' });
    }

    function onErr(err) {
      if (!activeRef.current) return;
      if (err.code === 3) {
        // Timeout — tenta rede/Wi-Fi silenciosamente
        watchRef.current = navigator.geolocation.watchPosition(
          onPos,
          () => onLocationUpdate({ error: 'GPS indisponível.' }),
          { enableHighAccuracy: false, maximumAge: 10000, timeout: 30000 }
        );
        return;
      }
      if (err.code === 1) onLocationUpdate({ error: 'Permissão de GPS negada.' });
      else onLocationUpdate({ error: 'GPS indisponível.' });
    }

    // Alta precisão — usa chip GPS do dispositivo
    watchRef.current = navigator.geolocation.watchPosition(onPos, onErr, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 15000,
    });
  }

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {/* Contador de artes */}
      {arts.length > 0 && (
        <div style={{
          position: 'absolute', top: 10, right: 10, zIndex: 9999,
          background: 'rgba(0,200,83,0.9)', color: '#000',
          padding: '5px 12px', borderRadius: 16, fontSize: 12, fontWeight: 700,
        }}>
          🎨 {arts.length} obra{arts.length !== 1 ? 's' : ''}
        </div>
      )}

      {/* Loading overlay */}
      {isLoading && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 9998,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 12,
        }}>
          <div style={{
            width: 36, height: 36, border: '3px solid transparent',
            borderTopColor: '#00c853', borderRightColor: '#F9A825',
            borderBottomColor: '#D32F2F', borderRadius: '50%',
            animation: 'spin 0.9s linear infinite',
          }} />
          <span style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>
            Carregando artes…
          </span>
        </div>
      )}

      {/* Botão reativar GPS */}
      <button
        onClick={() => startGPS()}
        title="Centralizar no meu GPS"
        style={{
          position: 'absolute', bottom: 80, right: 10, zIndex: 9999,
          background: '#111', color: '#fff', border: '2px solid #333',
          borderRadius: '50%', width: 42, height: 42, fontSize: 18,
          cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >📍</button>
    </div>
  );
}
