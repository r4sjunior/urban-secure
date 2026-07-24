/**
 * lib/hooks/useAlbum.js
 * Álbum de figurinhas da carteira conectada: carrega, abre pacote, cola.
 *
 * Não é um contexto global de propósito — o álbum só é usado na página do
 * álbum e no gatilho de pacote. Colocá-lo num provider faria o payload
 * (dezenas ou centenas de slots com metadados de arte) viver na memória do
 * app inteiro, inclusive enquanto o usuário só olha o mapa.
 */

import { useState, useEffect, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { buildStickerActionMessage } from '../stickers/stickerSignature';

const EMPTY_ALBUM = {
  slots: [], pocket: [], duplicates: [],
  pastedCount: 0, totalSlots: 0, completion: 0,
};

export function useAlbum() {
  const wallet = useWallet();
  const address = wallet.publicKey?.toBase58() || null;

  const [album, setAlbum] = useState(EMPTY_ALBUM);
  const [packs, setPacks] = useState(0);
  const [canTrade, setCanTrade] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async (target) => {
    if (!target) { setAlbum(EMPTY_ALBUM); setPacks(0); return; }

    setIsLoading(true);
    try {
      const res = await fetch(`/api/stickers?wallet=${encodeURIComponent(target)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Erro ao carregar o álbum.');

      setAlbum(json.album || EMPTY_ALBUM);
      setPacks(json.packsAvailable || 0);
      setCanTrade(!!json.canTrade);
      setError(null);
    } catch (err) {
      console.error('[useAlbum]', err.message);
      setError('Não foi possível carregar seu álbum.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { load(address); }, [address, load]);

  /** Assina a autorização da ação. A ação entra na mensagem porque colar é
   *  irreversível — uma assinatura dada pra colar não pode valer pra abrir. */
  const sign = useCallback(async (action, target = '') => {
    const timestamp = Date.now();
    const message = buildStickerActionMessage({ wallet: address, action, target, timestamp });
    const sigBytes = await wallet.signMessage(new TextEncoder().encode(message));
    return { timestamp, signature: Buffer.from(sigBytes).toString('base64') };
  }, [address, wallet]);

  /**
   * Abre um pacote. O sorteio acontece no servidor.
   * @returns {{ ok: boolean, sticker?, art?, rarity?, error? }}
   */
  const openPack = useCallback(async () => {
    if (!address || !wallet.signMessage) return { ok: false, error: 'Conecte sua carteira.' };

    setIsWorking(true);
    setError(null);
    try {
      const auth = await sign('open');
      const res = await fetch('/api/stickers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: address, action: 'open', ...auth }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error); return { ok: false, error: json.error }; }

      // Desconta na hora pra que o botão não permita abrir de novo enquanto a
      // animação roda; o load() no fim reconcilia com o servidor.
      setPacks(p => Math.max(0, p - 1));
      return { ok: true, ...json };
    } catch (err) {
      const msg = /rejected|cancel/i.test(err?.message || '') ? 'Autorização cancelada.' : 'Erro ao abrir o pacote.';
      setError(msg);
      return { ok: false, error: msg };
    } finally {
      setIsWorking(false);
    }
  }, [address, wallet, sign]);

  /** Cola uma figurinha no álbum. Irreversível. */
  const paste = useCallback(async (mint) => {
    if (!address || !wallet.signMessage) return { ok: false, error: 'Conecte sua carteira.' };

    setIsWorking(true);
    setError(null);
    try {
      const auth = await sign('paste', mint);
      const res = await fetch('/api/stickers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: address, action: 'paste', mint, ...auth }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error); return { ok: false, error: json.error }; }

      await load(address);
      return { ok: true };
    } catch (err) {
      const msg = /rejected|cancel/i.test(err?.message || '') ? 'Autorização cancelada.' : 'Erro ao colar.';
      setError(msg);
      return { ok: false, error: msg };
    } finally {
      setIsWorking(false);
    }
  }, [address, wallet, sign, load]);

  return {
    address, album, packs, canTrade,
    isLoading, isWorking, error,
    openPack, paste,
    refresh: () => load(address),
  };
}
