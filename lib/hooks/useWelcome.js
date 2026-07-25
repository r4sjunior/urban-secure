/**
 * lib/hooks/useWelcome.js
 * Estado do SOL de boas-vindas da carteira conectada.
 *
 * Reconsulta quando o PERFIL muda, não só quando a carteira muda: a
 * elegibilidade depende do cadastro estar completo, então salvar a bio
 * precisa liberar o botão na hora — sem isso o usuário completaria o perfil
 * e continuaria vendo "complete seu perfil".
 */

import { useState, useEffect, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useMyProfile } from '../../context/ProfileContext';
import { buildWelcomeMessage } from '../social/welcomeSignature';

export function useWelcome() {
  const wallet = useWallet();
  const { profile } = useMyProfile();
  const address = wallet.publicKey?.toBase58() || null;

  const [situacao, setSituacao] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!address) { setSituacao(null); return; }

    setIsLoading(true);
    try {
      const res = await fetch(`/api/welcome?wallet=${encodeURIComponent(address)}`);
      const json = await res.json();
      setSituacao(res.ok ? json : null);
    } catch (err) {
      console.error('[useWelcome]', err.message);
      setSituacao(null);
    } finally {
      setIsLoading(false);
    }
  }, [address]);

  // `profile?.updatedAt` na dependência: é o que muda quando o cadastro é
  // salvo, e é exatamente o gatilho da elegibilidade.
  useEffect(() => { load(); }, [load, profile?.updatedAt]);

  const receber = useCallback(async () => {
    if (!address || !wallet.signMessage) return { ok: false, error: 'Conecte sua carteira.' };

    setIsClaiming(true);
    setError(null);
    try {
      const timestamp = Date.now();
      const message = buildWelcomeMessage({ wallet: address, timestamp });
      const sigBytes = await wallet.signMessage(new TextEncoder().encode(message));

      const res = await fetch('/api/welcome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet: address, timestamp,
          signature: Buffer.from(sigBytes).toString('base64'),
        }),
      });
      const json = await res.json();

      if (!res.ok) { setError(json.error); await load(); return { ok: false, error: json.error }; }

      setResultado(json);
      await load();
      return { ok: true, ...json };
    } catch (err) {
      if (/rejected|cancel/i.test(err?.message || '')) {
        setError('Autorização cancelada.');
        return { ok: false, error: 'Autorização cancelada.' };
      }

      // Mesma reconciliação do claim (ver context/ClaimContext.jsx): o SOL
      // sai antes da resposta, então "a conexão falhou" não quer dizer "não
      // recebeu". Reconsultar é o que evita o usuário achar que perdeu o
      // benefício de uso único.
      await load();
      const msg = 'A conexão falhou. Confira seu saldo antes de tentar de novo.';
      setError(msg);
      return { ok: false, error: msg };
    } finally {
      setIsClaiming(false);
    }
  }, [address, wallet, load]);

  return {
    situacao,
    // Só vale mostrar o convite para quem pode agir agora ou está a um passo.
    mostrar: !!situacao && !situacao.jaRecebeu && !situacao.jaClaimou,
    isLoading, isClaiming, error, resultado,
    receber,
    limparResultado: () => setResultado(null),
    refresh: load,
  };
}
