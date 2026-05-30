/**
 * context/ArtsContext.jsx
 *
 * Estado global das artes urbanas com:
 *  - Cache em sessionStorage (carregamento instantâneo no refresh)
 *  - Busca em background da blockchain Solana
 *  - Merge inteligente: cache + novos dados on-chain
 *  - addArt() para atualizar o mapa imediatamente após o mint
 */

import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { fetchAllUrbanArts } from '../lib/fetchArts';

const CACHE_TTL_MS  = 5 * 60 * 1000; // 5 minutos
const CACHE_KEY     = (net) => `urban-secure:arts:${net}`;

// ── Cache helpers ─────────────────────────────────────────────

function readCache(network) {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY(network));
    if (!raw) return null;
    const { ts, arts } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL_MS) return null; // expirado
    return arts;
  } catch { return null; }
}

function writeCache(network, arts) {
  try {
    sessionStorage.setItem(CACHE_KEY(network), JSON.stringify({ ts: Date.now(), arts }));
  } catch { /* quota exceeded — ignora */ }
}

function mergeArts(existing, incoming) {
  const map = new Map(existing.map(a => [a.id, a]));
  incoming.forEach(a => map.set(a.id, a)); // incoming sobrescreve
  return Array.from(map.values());
}

// ── Context ───────────────────────────────────────────────────

const ArtsContext = createContext(null);

export function ArtsProvider({ children }) {
  const wallet  = useWallet();
  const network = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet';

  const [arts,          setArts]          = useState([]);
  const [isLoading,     setIsLoading]     = useState(false);
  const [lastFetchedAt, setLastFetchedAt] = useState(null);
  const fetchingRef = useRef(false); // evita fetches paralelos

  // ── Carrega cache imediatamente ao montar ─────────────────
  useEffect(() => {
    const cached = readCache(network);
    if (cached?.length) {
      setArts(cached);
      console.log(`[ArtsContext] Cache carregado: ${cached.length} artes`);
    }
  }, [network]);

  // ── Busca da blockchain em background ────────────────────
  const fetchFromChain = useCallback(async () => {
    if (!wallet.publicKey)    return;
    if (fetchingRef.current)  return; // já buscando

    fetchingRef.current = true;
    setIsLoading(true);

    try {
      console.log('[ArtsContext] Buscando artes na Solana…');
      const chainArts = await fetchAllUrbanArts(wallet, network);

      setArts(prev => {
        const merged = mergeArts(prev, chainArts);
        writeCache(network, merged);
        console.log(`[ArtsContext] ${chainArts.length} artes da chain. Total: ${merged.length}`);
        return merged;
      });

      setLastFetchedAt(Date.now());
    } catch (err) {
      console.error('[ArtsContext] Fetch error:', err);
    } finally {
      setIsLoading(false);
      fetchingRef.current = false;
    }
  }, [wallet.publicKey, network]);

  // Dispara fetch quando wallet conecta
  useEffect(() => {
    if (wallet.publicKey) fetchFromChain();
  }, [wallet.publicKey]);

  // ── addArt: chamado logo após o mint ─────────────────────
  // Atualiza o mapa em tempo real sem esperar nova busca na chain
  const addArt = useCallback((art) => {
    setArts(prev => {
      const merged = mergeArts(prev, [art]);
      writeCache(network, merged);
      return merged;
    });
  }, [network]);

  return (
    <ArtsContext.Provider value={{ arts, isLoading, lastFetchedAt, addArt, refetch: fetchFromChain }}>
      {children}
    </ArtsContext.Provider>
  );
}

export function useArts() {
  const ctx = useContext(ArtsContext);
  if (!ctx) throw new Error('useArts deve ser usado dentro de <ArtsProvider>');
  return ctx;
}
