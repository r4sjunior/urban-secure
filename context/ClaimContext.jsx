/**
 * context/ClaimContext.jsx
 * Estado do claim diário da carteira conectada.
 *
 * O resgate é ON-CHAIN: `claim()` monta a instrução `claim_daily` do programa
 * `urban_social` e pede a assinatura da carteira. O servidor entrou só na
 * leitura (`GET /api/claim`), que consulta a conta do programa.
 *
 * Consequência que a UI precisa comunicar: o usuário agora paga a taxa de rede
 * e, no primeiro resgate, o rent da própria conta de estado (~0.0013 SOL).
 * Quem chega com a carteira zerada passa antes pelo claim de boas-vindas, que
 * continua off-chain justamente para quebrar esse impasse.
 *
 * Guarda apenas DADOS — nenhum contador regressivo mora aqui. O countdown é
 * responsabilidade do ClaimButton: um tick de 1s neste contexto
 * re-renderizaria o app inteiro (mapa, feed, dock) uma vez por segundo, o
 * que derruba o frame rate do Leaflet num celular por nada. O contexto
 * fornece `nextClaimAt`; quem precisa de precisão de segundo conta sozinho.
 */

import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { sendClaimDaily } from '../lib/anchor/onchainClaim';
import { STREAK_TARGET } from '../lib/config';

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

  // Estado do cofre on-chain. Separa dois "não dá pra resgatar" que o usuário
  // não distingue sozinho: o cooldown DELE não venceu, ou o faucet do dia
  // acabou pra todo mundo.
  const [vault, setVault] = useState(null);

  // Orientação de onboarding vinda do servidor — não é mais uma trava, já que
  // o programa não a implementa. Ver o cabeçalho de pages/api/claim.js.
  const [needsArt, setNeedsArt] = useState(false);

  // Histórico do claim off-chain anterior à migração. Nunca soma ao streak
  // atual; existe para a tela poder dizer "seu histórico antigo continua aqui"
  // em vez de dar a impressão de que os dados sumiram.
  const [legacy, setLegacy] = useState(null);

  // Resultado do último claim bem-sucedido — alimenta o modal de confirmação
  // e, quando fecha um ciclo, o gatilho da abertura de pacote.
  const [lastResult, setLastResult] = useState(null);

  // Mesma guarda de corrida do ProfileContext: trocar de conta no Phantom
  // com um fetch no ar faria a resposta antiga sobrescrever o estado novo.
  const requestedFor = useRef(null);

  /**
   * Busca o estado sem tocar no React — devolve o JSON cru.
   *
   * Separado de `load` porque o claim precisa do estado NOVO logo depois de a
   * transação confirmar, e esperar um `setState` propagar para depois lê-lo do
   * contexto devolveria o valor velho.
   */
  const fetchStatus = useCallback(async (target) => {
    const res = await fetch(`/api/claim?wallet=${encodeURIComponent(target)}`);
    const json = await res.json();
    return { ok: res.ok, json };
  }, []);

  const applyStatus = useCallback((json) => {
    setStatus(json.status || EMPTY_STATUS);
    setVault(json.vault || null);
    setNeedsArt(!!json.needsArt);
    setLegacy(json.legacy || null);
  }, []);

  const load = useCallback(async (target) => {
    if (!target) {
      setStatus(EMPTY_STATUS);
      return;
    }

    requestedFor.current = target;
    setIsLoading(true);

    try {
      const { ok: resOk, json } = await fetchStatus(target);
      if (requestedFor.current !== target) return;

      if (!resOk) {
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

      applyStatus(json);
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
  }, [fetchStatus, applyStatus]);

  useEffect(() => { load(address); }, [address, load]);

  /**
   * Executa o claim: monta `claim_daily` e pede a assinatura da carteira.
   *
   * Não há mais chamada de escrita ao servidor. Quem valida cooldown, streak,
   * teto diário e saldo é o programa — e ele o faz na mesma transação que move
   * o SOL, então não existe estado intermediário para desfazer.
   *
   * @returns {{ ok: boolean, error?: string, completedCycle?: boolean }}
   */
  const claim = useCallback(async () => {
    if (!address) return { ok: false, error: 'Conecte sua carteira.' };
    if (!wallet.sendTransaction) {
      return { ok: false, error: 'Esta carteira não suporta envio de transação.' };
    }

    setIsClaiming(true);
    setError(null);

    // Quanto ESTE resgate paga, segundo o estado de antes de enviar. Depois da
    // transação a conta já mostra o próximo valor, e o modal precisa exibir o
    // que acabou de entrar na carteira.
    const amountSol = status.amountSol;

    try {
      const { signature } = await sendClaimDaily(wallet);

      // O estado definitivo vem da chain, não de um retorno nosso: é a única
      // fonte que não pode discordar do que realmente aconteceu.
      const { ok: resOk, json } = await fetchStatus(address);
      const novoStreak = resOk ? (json.status?.currentStreak || 0) : 0;
      if (resOk) applyStatus(json);

      const completedCycle = novoStreak > 0 && novoStreak % STREAK_TARGET === 0;

      setLastResult({
        signature,
        amountSol,
        streak: novoStreak,
        completedCycle,
        // A figurinha é mintada pela feature de pacotes; aqui só sinalizamos
        // que há um pacote esperando.
        packAvailable: completedCycle,
      });

      return { ok: true, completedCycle };
    } catch (err) {
      // `pending` significa que a transação foi enviada mas o status não
      // apareceu a tempo — ela ainda pode confirmar. Reler a chain resolve a
      // ambiguidade: se o cooldown já está fechado, o resgate passou.
      if (err?.pending) {
        try {
          const { ok: resOk, json } = await fetchStatus(address);
          if (resOk && json.status && !json.status.canClaim) {
            applyStatus(json);
            setError(null);
            setLastResult({
              signature: err.signature || null,
              amountSol,
              streak: json.status.currentStreak,
              completedCycle: false,
              packAvailable: false,
              reconciliado: true,
            });
            return { ok: true, reconciliado: true };
          }
        } catch { /* a consulta também falhou; cai no erro normal */ }
      }

      // As mensagens já vêm traduzidas de parseProgramError — inclusive as do
      // próprio programa ("Seu próximo resgate ainda não liberou.").
      const msg = err?.message || 'Não foi possível resgatar.';
      setError(msg);

      // Recarrega mesmo em caso de erro: a recusa mais comum é cooldown, e o
      // botão precisa refletir o tempo restante em vez de continuar clicável.
      load(address);

      return { ok: false, error: msg };
    } finally {
      setIsClaiming(false);
    }
  }, [address, wallet, status.amountSol, fetchStatus, applyStatus, load]);

  const value = {
    status,
    vault,
    needsArt,
    legacy,
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
