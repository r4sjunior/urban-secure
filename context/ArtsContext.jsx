/**
 * context/ArtsContext.jsx
 * Estado global das artes — busca SEM precisar de carteira.
 */
import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_KEY = (net) => `urban-secure:arts:${net}`;

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
  try { sessionStorage.setItem(CACHE_KEY(network), JSON.stringify({ ts: Date.now(), arts })); } catch {}
}
function mergeArts(existing, incoming) {
  const map = new Map(existing.map(a => [a.id, a]));
  incoming.forEach(a => map.set(a.id, a));
  return Array.from(map.values());
}

const ArtsContext = createContext(null);

export function ArtsProvider({ children }) {
  const network = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet';
  const [arts, setArts] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const fetchingRef = useRef(false);

  const fetchFromChain = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    setIsLoading(true);
    try {
      const res = await fetch('/api/arts');
      if (!res.ok) return;
      const data = await res.json();
      const chainArts = data?.arts ?? [];
      if (chainArts.length === 0) return;
      setArts(prev => {
        const merged = mergeArts(prev, chainArts);
        writeCache(network, merged);
        return merged;
      });
    } catch (err) {
      console.error('[ArtsContext]', err.message);
    } finally {
      setIsLoading(false);
      fetchingRef.current = false;
    }
  }, [network]);

  useEffect(() => {
    const cached = readCache(network);
    if (cached?.length) setArts(cached);
    fetchFromChain();
  }, [fetchFromChain, network]);

  const addArt = useCallback((art) => {
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
  if (!ctx) throw new Error('useArts dentro de <ArtsProvider>');
  return ctx;
}
