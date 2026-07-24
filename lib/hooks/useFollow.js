/**
 * lib/hooks/useFollow.js
 * Estado social de um perfil: contadores e a ação de seguir.
 *
 * Fica num hook, e não dentro do botão, porque os contadores aparecem em
 * todo perfil — inclusive no próprio, onde não existe botão de seguir. Se a
 * busca vivesse no FollowButton, o usuário não veria os próprios seguidores.
 */

import { useState, useEffect, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { buildFollowMessage } from '../social/followSignature';

export function useFollow(targetWallet) {
  const wallet = useWallet();
  const viewer = wallet.publicKey?.toBase58() || null;

  const [followers, setFollowers] = useState(null); // null = carregando
  const [following, setFollowing] = useState(null);
  const [isFollowing, setIsFollowing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!targetWallet) return;
    try {
      const url = `/api/follow?wallet=${encodeURIComponent(targetWallet)}` +
        (viewer ? `&viewer=${encodeURIComponent(viewer)}` : '');
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) return;

      setFollowers(json.followers ?? 0);
      setFollowing(json.following ?? 0);
      setIsFollowing(json.isFollowing);
    } catch (err) {
      console.error('[useFollow]', err.message);
      // Contador é enfeite: falhar a leitura não pode quebrar a tela de
      // perfil. Zera e segue.
      setFollowers(0);
      setFollowing(0);
    }
  }, [targetWallet, viewer]);

  useEffect(() => { load(); }, [load]);

  /**
   * Alterna seguir/deixar de seguir com atualização otimista.
   *
   * Aplica na UI antes da resposta porque seguir é ação de baixo risco e alta
   * frequência — esperar o round-trip faria o botão parecer travado. Se o
   * servidor recusar, reverte: nada irreversível aconteceu.
   */
  const toggle = useCallback(async () => {
    if (busy || !viewer || !wallet.signMessage || viewer === targetWallet) return;

    const action = isFollowing ? 'unfollow' : 'follow';
    const anterior = { isFollowing, followers };

    setIsFollowing(!isFollowing);
    setFollowers(n => Math.max(0, (n ?? 0) + (isFollowing ? -1 : 1)));
    setBusy(true);
    setError(null);

    try {
      const timestamp = Date.now();
      const message = buildFollowMessage({ follower: viewer, target: targetWallet, action, timestamp });
      const sigBytes = await wallet.signMessage(new TextEncoder().encode(message));

      const res = await fetch('/api/follow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          follower: viewer, target: targetWallet, action, timestamp,
          signature: Buffer.from(sigBytes).toString('base64'),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Não foi possível salvar.');

      // Reconcilia com o número do servidor — outra pessoa pode ter seguido
      // no meio-tempo, e o incremento local não saberia disso.
      setIsFollowing(json.isFollowing);
      setFollowers(json.followers);
    } catch (err) {
      setIsFollowing(anterior.isFollowing);
      setFollowers(anterior.followers);
      setError(/rejected|cancel/i.test(err?.message || '') ? 'Cancelado.' : err.message);
      setTimeout(() => setError(null), 2600);
    } finally {
      setBusy(false);
    }
  }, [busy, viewer, wallet, targetWallet, isFollowing, followers]);

  return {
    followers, following, isFollowing, busy, error,
    canFollow: !!viewer && viewer !== targetWallet,
    toggle,
    refresh: load,
  };
}
