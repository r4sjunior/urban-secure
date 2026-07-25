/**
 * lib/hooks/useFollow.js
 * Estado social de um perfil: contadores e a ação de seguir.
 *
 * Fica num hook, e não dentro do botão, porque os contadores aparecem em
 * todo perfil — inclusive no próprio, onde não existe botão de seguir. Se a
 * busca vivesse no FollowButton, o usuário não veria os próprios seguidores.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchJson } from '../fetchJson';
import { useWallet } from '@solana/wallet-adapter-react';
import { buildFollowMessage } from '../social/followSignature';

export function useFollow(targetWallet) {
  const wallet = useWallet();
  const viewer = wallet.publicKey?.toBase58() || null;

  const [followers, setFollowers] = useState(null);
  const [following, setFollowing] = useState(null);

  // `null` aqui significa APENAS "ainda não carregou".
  //
  // Antes, o servidor devolvia `null` quando não havia carteira conectada, e
  // esse null chegava até o botão, que ficava desabilitado para sempre
  // mostrando "···" — o usuário não conseguia seguir ninguém, nem depois de
  // conectar. Agora, sem viewer o valor é `false` (não segue), e o botão só
  // fica bloqueado durante o carregamento de verdade.
  const [isFollowing, setIsFollowing] = useState(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Guarda de corrida: trocar de perfil ou de carteira com um fetch no ar
  // faria a resposta antiga sobrescrever o estado novo.
  const pedidoPara = useRef(null);

  const load = useCallback(async () => {
    if (!targetWallet) return;

    const chave = `${targetWallet}:${viewer || ''}`;
    pedidoPara.current = chave;

    try {
      const url = `/api/follow?wallet=${encodeURIComponent(targetWallet)}` +
        (viewer ? `&viewer=${encodeURIComponent(viewer)}` : '');
      const { ok, data: json, error: erroHttp } = await fetchJson(url);
      if (pedidoPara.current !== chave) return;
      if (!ok) throw new Error(json.error || erroHttp || 'erro');

      setFollowers(json.followers ?? 0);
      setFollowing(json.following ?? 0);
      setIsFollowing(json.isFollowing === true);
    } catch (err) {
      if (pedidoPara.current !== chave) return;
      console.error('[useFollow]', err.message);
      // Contador é enfeite: falhar a leitura não pode quebrar a tela nem
      // travar o botão. Assume "não segue" — a ação é reversível, e o
      // servidor recusa com clareza se já estiver seguindo.
      setFollowers(f => f ?? 0);
      setFollowing(f => f ?? 0);
      setIsFollowing(f => f ?? false);
    }
  }, [targetWallet, viewer]);

  useEffect(() => { load(); }, [load]);

  // Recarrega ao voltar para a aba. Em celular o app fica minutos em segundo
  // plano e volta com contadores velhos — e, pior, com um "Seguindo" que já
  // não corresponde ao servidor.
  useEffect(() => {
    const aoVoltar = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', aoVoltar);
    return () => document.removeEventListener('visibilitychange', aoVoltar);
  }, [load]);

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

      const { ok, data: json, error: erroHttp } = await fetchJson('/api/follow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          follower: viewer, target: targetWallet, action, timestamp,
          signature: Buffer.from(sigBytes).toString('base64'),
        }),
      });
      if (!ok) throw new Error(json.error || erroHttp || 'Não foi possível salvar.');

      // Reconcilia com o número do servidor — outra pessoa pode ter seguido
      // no meio-tempo, e o incremento local não saberia disso.
      setIsFollowing(json.isFollowing === true);
      setFollowers(json.followers ?? 0);
    } catch (err) {
      const cancelou = /rejected|cancel/i.test(err?.message || '');
      setIsFollowing(anterior.isFollowing);
      setFollowers(anterior.followers);
      setError(cancelou ? 'Cancelado.' : err.message);
      setTimeout(() => setError(null), 2600);

      // Se não foi o usuário que cancelou, a ação pode ter sido gravada e a
      // resposta se perdido. Reconsultar evita o botão ficar mentindo.
      if (!cancelou) load();
    } finally {
      setBusy(false);
    }
  }, [busy, viewer, wallet, targetWallet, isFollowing, followers, load]);

  return {
    followers, following, isFollowing, busy, error,
    // `carregando` separado de `isFollowing`: o botão precisa distinguir
    // "ainda não sei" de "não segue".
    carregando: isFollowing === null,
    canFollow: !!viewer && viewer !== targetWallet,
    toggle,
    refresh: load,
  };
}
