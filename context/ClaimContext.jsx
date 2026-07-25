/**
 * context/ClaimContext.jsx
 * Estado do claim diário da carteira conectada.
 *
 * Guarda apenas DADOS — nenhum contador regressivo mora aqui. O countdown é
 * responsabilidade do ClaimButton: um tick de 1s neste contexto
 * re-renderizaria o app inteiro (mapa, feed, dock) uma vez por segundo, o
 * que derruba o frame rate do Leaflet num celular por nada. O contexto
 * fornece `nextClaimAt`; quem precisa de precisão de segundo conta sozinho.
 */

import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { buildClaimMessage, claimDay } from '../lib/social/claimSignature';

const ClaimContext = createContext(null);

const EMPTY_STATUS = {
  canClaim: false,
  currentStreak: 0,
  nextStreak: 1,
  nextClaimAt: 0,
  msUntilNext: 0,
  streakExpiresAt: 0,
  streakAtRisk: false,
  willCompleteCycle: false,
  daysToNextPack: 7,
  amountSol: 0,
  completedCycles: 0,
  longestStreak: 0,
  totalClaims: 0,
};

export function ClaimProvider({ children }) {
  const wallet = useWallet();
  const address = wallet.publicKey?.toBase58() || null;

  const [status, setStatus] = useState(EMPTY_STATUS);
  const [isLoading, setIsLoading] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [error, setError] = useState(null);

  // Resultado do último claim bem-sucedido — alimenta o modal de confirmação
  // e, quando fecha um ciclo, o gatilho da abertura de pacote.
  const [lastResult, setLastResult] = useState(null);

  // Mesma guarda de corrida do ProfileContext: trocar de conta no Phantom
  // com um fetch no ar faria a resposta antiga sobrescrever o estado novo.
  const requestedFor = useRef(null);

  const load = useCallback(async (target) => {
    if (!target) {
      setStatus(EMPTY_STATUS);
      return;
    }

    requestedFor.current = target;
    setIsLoading(true);

    try {
      const res = await fetch(`/api/claim?wallet=${encodeURIComponent(target)}`);
      const json = await res.json();
      if (requestedFor.current !== target) return;

      if (!res.ok) {
        // Configuração incompleta no servidor não é falha transitória: o
        // botão vai ficar indisponível para sempre, e esconder o motivo faz
        // o usuário achar que o app está quebrado sem saber o que houve.
        // Este é o único erro de LEITURA que merece aparecer na tela.
        if (json.configIncompleta) {
          setStatus(EMPTY_STATUS);
          setError(json.error);
          return;
        }
        throw new Error(json.error || 'Erro ao consultar o claim.');
      }

      setStatus(json.status || EMPTY_STATUS);
      setError(null);
    } catch (err) {
      if (requestedFor.current !== target) return;
      console.error('[ClaimContext] load:', err.message);
      // Falha transitória de leitura segue silenciosa: o botão fica
      // indisponível e tentar de novo resolve, então um alerta vermelho
      // permanente seria ruído.
      setStatus(EMPTY_STATUS);
    } finally {
      if (requestedFor.current === target) setIsLoading(false);
    }
  }, []);

  useEffect(() => { load(address); }, [address, load]);

  /**
   * Executa o claim: assina a autorização e chama o endpoint.
   * @returns {{ ok: boolean, error?: string, needsArt?: boolean }}
   */
  const claim = useCallback(async () => {
    if (!address) return { ok: false, error: 'Conecte sua carteira.' };
    if (!wallet.signMessage) {
      return { ok: false, error: 'Esta carteira não suporta assinatura de mensagem.' };
    }

    setIsClaiming(true);
    setError(null);

    try {
      const timestamp = Date.now();
      const day = claimDay(timestamp);
      const message = buildClaimMessage({ wallet: address, day, timestamp });

      const sigBytes = await wallet.signMessage(new TextEncoder().encode(message));
      const signature = Buffer.from(sigBytes).toString('base64');

      const res = await fetch('/api/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: address, timestamp, signature }),
      });
      const json = await res.json();

      // O servidor devolve o status atualizado junto com o erro — aproveitar
      // isso evita um GET extra e mantém o botão coerente com o motivo da
      // recusa (ex.: cooldown que virou enquanto o usuário assinava).
      if (json.status) setStatus(json.status);

      if (!res.ok) {
        setError(json.error || 'Não foi possível resgatar.');
        return { ok: false, error: json.error, needsArt: !!json.needsArt };
      }

      setLastResult({
        signature: json.signature,
        amountSol: json.amountSol,
        streak: json.streak,
        completedCycle: json.completedCycle,
        packAvailable: json.packAvailable,
      });

      return { ok: true, completedCycle: json.completedCycle };
    } catch (err) {
      const raw = err?.message || 'Erro ao resgatar.';
      const cancelou = /rejected|User rejected|cancel/i.test(raw);

      if (cancelou) {
        setError('Autorização cancelada.');
        return { ok: false, error: 'Autorização cancelada.' };
      }

      // A resposta não chegou — mas o resgate pode ter acontecido.
      //
      // O servidor transfere o SOL e grava o estado ANTES de responder. Se a
      // conexão cair, ou a função exceder o tempo, o dinheiro saiu e o
      // usuário vê "erro" — foi exatamente o que aconteceu: o claim
      // contabilizou e a tela acusou falha, exigindo F5.
      //
      // Consultar o estado real resolve a ambiguidade: se o cooldown já está
      // valendo, o resgate deu certo e dizemos isso.
      try {
        const res = await fetch(`/api/claim?wallet=${encodeURIComponent(address)}`);
        const json = await res.json();

        if (res.ok && json.status && !json.status.canClaim) {
          setStatus(json.status);
          setError(null);
          setLastResult({
            // Sem os detalhes da transação — só sabemos que passou.
            signature: null,
            amountSol: json.status.amountSol,
            streak: json.status.currentStreak,
            completedCycle: false,
            packAvailable: false,
            reconciliado: true,
          });
          return { ok: true, reconciliado: true };
        }
      } catch { /* a consulta também falhou; segue para o erro normal */ }

      const msg = 'A conexão falhou durante o resgate. Puxe a tela para atualizar e confira seu streak.';
      setError(msg);
      return { ok: false, error: msg };
    } finally {
      setIsClaiming(false);
    }
  }, [address, wallet]);

  const value = {
    status,
    isLoading,
    isClaiming,
    error,
    lastResult,
    claim,
    clearResult: () => setLastResult(null),
    refresh: () => load(address),
  };

  return <ClaimContext.Provider value={value}>{children}</ClaimContext.Provider>;
}

export function useClaim() {
  const ctx = useContext(ClaimContext);
  if (!ctx) throw new Error('useClaim deve ser usado dentro de <ClaimProvider>');
  return ctx;
}
