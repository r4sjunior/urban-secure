/**
 * context/GeoContext.jsx
 * Rastreio de localização, vivo enquanto o app estiver aberto.
 *
 * POR QUE ISTO SAIU DO MAPA: o watchPosition vivia dentro do MapView. Ao
 * navegar para o álbum ou o ranking, o mapa era desmontado e o rastreio
 * morria junto; ao voltar, começava tudo de novo. O aparelho reacendia o
 * sensor e mostrava o indicador de localização a cada ida e volta — a
 * sensação de "o app fica pedindo GPS o tempo todo".
 *
 * Aqui o rastreio é iniciado uma vez e acompanha a sessão. O mapa passa a
 * ser um consumidor: aparece, lê a posição atual e desenha.
 *
 * O watch é pausado quando o app vai para segundo plano e retomado ao
 * voltar — manter o GPS ativo com a tela desligada gasta bateria sem nenhum
 * ganho, e é o tipo de coisa que faz o usuário desinstalar.
 */

import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';

const GeoContext = createContext(null);

const OPCOES = {
  enableHighAccuracy: true,
  // Aceita uma leitura de até 15s do sistema em vez de exigir medição nova.
  // Para marcar um muro, a diferença é irrelevante; para a bateria, não.
  maximumAge: 15000,
  timeout: 30000,
};

export function GeoProvider({ children }) {
  const [posicao, setPosicao] = useState(null); // { lat, lng, acc, fonte } | { error }
  const watchRef = useRef(null);
  const ativoRef = useRef(true);

  const parar = useCallback(() => {
    if (watchRef.current !== null) {
      navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
    }
  }, []);

  const iniciar = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setPosicao({ error: 'GPS não disponível neste dispositivo.' });
      return;
    }
    // Já rastreando: não recomeça. Cada watch novo reacende o sensor.
    if (watchRef.current !== null) return;

    const aoReceber = (pos) => {
      if (!ativoRef.current) return;
      setPosicao({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        acc: Math.round(pos.coords.accuracy),
        fonte: 'GPS',
      });
    };

    const aoFalhar = (err) => {
      if (!ativoRef.current) return;

      // Timeout com alta precisão: tenta de novo aceitando menos precisão,
      // em vez de desistir. Dentro de prédio, é a diferença entre ter
      // localização aproximada e não ter nenhuma.
      if (err.code === 3 && watchRef.current !== null) {
        navigator.geolocation.clearWatch(watchRef.current);
        watchRef.current = navigator.geolocation.watchPosition(
          aoReceber,
          () => setPosicao({ error: 'GPS indisponível.' }),
          { enableHighAccuracy: false, maximumAge: 30000, timeout: 30000 }
        );
        return;
      }

      setPosicao({
        error: err.code === 1
          ? 'Permissão de GPS negada. Libere nas configurações do navegador.'
          : 'GPS indisponível. Vá para uma área aberta.',
      });
    };

    watchRef.current = navigator.geolocation.watchPosition(aoReceber, aoFalhar, OPCOES);
  }, []);

  useEffect(() => {
    ativoRef.current = true;
    iniciar();

    // Pausa em segundo plano, retoma ao voltar.
    const aoMudarVisibilidade = () => {
      if (document.visibilityState === 'visible') iniciar();
      else parar();
    };
    document.addEventListener('visibilitychange', aoMudarVisibilidade);

    return () => {
      ativoRef.current = false;
      document.removeEventListener('visibilitychange', aoMudarVisibilidade);
      parar();
    };
  }, [iniciar, parar]);

  return (
    <GeoContext.Provider value={{ posicao, reiniciar: () => { parar(); iniciar(); } }}>
      {children}
    </GeoContext.Provider>
  );
}

export function useGeo() {
  const ctx = useContext(GeoContext);
  if (!ctx) throw new Error('useGeo deve ser usado dentro de <GeoProvider>');
  return ctx;
}
