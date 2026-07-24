/**
 * lib/hooks/useProfile.js
 * Lê o perfil de QUALQUER carteira (o próprio vem do ProfileContext).
 *
 * Usado onde aparece o nome/avatar do artista: popup do mapa, feed, álbum de
 * figurinhas, ranking. Nesses lugares a mesma carteira reaparece dezenas de
 * vezes na mesma tela, então o cache em módulo não é otimização prematura —
 * sem ele, um feed com 30 posts do mesmo artista dispara 30 requests
 * idênticos.
 */

import { useState, useEffect } from 'react';
import { defaultProfile } from '../social/profile';

const TTL_MS = 5 * 60 * 1000;

/** wallet → { at, data } */
const cache = new Map();

/** wallet → Promise — deduplica requests simultâneos da mesma carteira.
 *  Sem isto, 30 componentes montando no mesmo frame disparariam 30 fetches
 *  antes de qualquer um popular o cache. */
const inFlight = new Map();

async function fetchProfile(wallet) {
  const cached = cache.get(wallet);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.data;

  if (inFlight.has(wallet)) return inFlight.get(wallet);

  const promise = (async () => {
    try {
      const res = await fetch(`/api/profile?wallet=${encodeURIComponent(wallet)}`);
      if (!res.ok) throw new Error(String(res.status));
      const json = await res.json();
      const data = { profile: json.profile || defaultProfile(wallet), stats: json.stats };
      cache.set(wallet, { at: Date.now(), data });
      return data;
    } catch {
      // Perfil é enfeite, não conteúdo: se a leitura falhar, mostra o perfil
      // vazio (endereço encurtado + avatar gerado) em vez de quebrar a tela
      // que só queria exibir um nome.
      const data = { profile: defaultProfile(wallet), stats: null };
      cache.set(wallet, { at: Date.now(), data });
      return data;
    } finally {
      inFlight.delete(wallet);
    }
  })();

  inFlight.set(wallet, promise);
  return promise;
}

/** Invalida o cache de uma carteira — chamar após salvar o próprio perfil,
 *  senão o feed continua mostrando o avatar antigo por até 5 minutos. */
export function invalidateProfile(wallet) {
  cache.delete(wallet);
}

export function useProfile(wallet) {
  const [state, setState] = useState(() => ({
    profile: wallet ? defaultProfile(wallet) : null,
    stats: null,
    isLoading: !!wallet,
  }));

  useEffect(() => {
    if (!wallet) {
      setState({ profile: null, stats: null, isLoading: false });
      return;
    }

    let alive = true;
    setState(s => ({ ...s, isLoading: true }));

    fetchProfile(wallet).then(data => {
      if (alive) setState({ ...data, isLoading: false });
    });

    return () => { alive = false; };
  }, [wallet]);

  return state;
}
