/**
 * context/ArtsContext.jsx
 * Estado global das artes com sessionStorage cache e busca em background.
 */

import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_KEY    = (net) => `urban-secure:arts:${net}`;

function readCache(network) {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY(network));
    if (!raw) return null;
    const { ts, arts } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL_MS) return null;
    return arts;
  } catch { return null; }
}

function writeCache(network, arts) {
  try {
    sessionStorage.setItem(CACHE_KEY(network), JSON.stringify({ ts: Date.now(), arts }));
  } catch { /* quota */ }
}

function mergeArts(existing, incoming) {
  const map = new Map(existing.map(a => [a.id, a]));
  incoming.forEach(a => map.set(a.id, a));
  return Array.from(map.values());
}

const ArtsContext = createContext(null);

export function ArtsProvider({ children }) {
  const network     = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet';
  const [arts,      setArts]      = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const fetchingRef = useRef(false);

  // Carrega cache imediatamente
  useEffect(() => {
    const cached = readCache(network);
    if (cached?.length) {
      console.log(`[ArtsContext] cache: ${cached.length} artes`);
      setArts(cached);
    }
    // Busca sempre ao montar (em background)
    fetchFromChain();
  }, []);

  const fetchFromChain = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    setIsLoading(true);

    try {
      console.log('[ArtsContext] buscando /api/arts…');
      const res = await fetch('/api/arts');

      if (!res.ok) {
        console.error('[ArtsContext] /api/arts retornou', res.status);
        return;
      }

      const data = await res.json();

      if (!data.arts) {
        console.error('[ArtsContext] resposta sem campo arts:', data);
        return;
      }

      if (data.arts.length === 0) {
        console.log('[ArtsContext] nenhuma arte encontrada no Helius');
        return;
      }

      console.log(`[ArtsContext] ${data.arts.length} artes recebidas da chain`);

      setArts(prev => {
        const merged = mergeArts(prev, data.arts);
        writeCache(network, merged);
        console.log(`[ArtsContext] total no mapa: ${merged.length}`);
        return merged;
      });

    } catch (err) {
      console.error('[ArtsContext] erro ao buscar artes no Helius:', err.message);
    } finally {
      setIsLoading(false);
      fetchingRef.current = false;
    }
  }, [network]);

  // addArt: atualiza mapa imediatamente após mint
  const addArt = useCallback((art) => {
    console.log('[ArtsContext] nova arte adicionada:', art.id);
    setArts(prev => {
      const merged = mergeArts(prev, [art]);
      writeCache(network, merged);
      return merged;
    });
  }, [network]);

  return (
    <ArtsContext.Provider value={{ arts, isLoading, addArt, refetch: fetchFromChain }}>
      {children}
    </ArtsContext.Provider>
  );
}

export function useArts() {
  const ctx = useContext(ArtsContext);
  if (!ctx) throw new Error('useArts deve ser usado dentro de <ArtsProvider>');
  return ctx;
}
