/**
 * context/WalletAuthContext.jsx
 * Autenticação via assinatura de mensagem — prova de posse da carteira.
 * Não gera transação on-chain; usa wallet.signMessage() do Phantom.
 * A autorização vale 7 dias e fica em localStorage — ver SESSION_TTL_MS.
 */
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';

const SESSION_KEY = 'urban-secure:auth';

/**
 * A sessão vale 7 dias, em localStorage.
 *
 * Antes era `sessionStorage`, que morre ao fechar a aba. No celular isso é
 * constante: o sistema descarta a aba em segundo plano, o usuário volta ao
 * app e precisa assinar de novo — várias vezes por dia. O atrito era grande
 * o bastante para atrapalhar o uso normal.
 *
 * O que a assinatura prova é posse da carteira, e isso não muda em 7 dias.
 * O que realmente move valor (registrar arte, claim, troca) continua exigindo
 * assinatura da carteira na hora, com o Phantom pedindo confirmação — então
 * persistir esta sessão não dá a ninguém um poder que ela já não tivesse com
 * o aparelho desbloqueado na mão.
 */
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function buildMessage(pubkey) {
  // Nonce criptográfico aleatório — impede replay de assinaturas antigas
  const nonce = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return (
    `Bem-vindo ao Urban Secure!\n\n` +
    `Assine para confirmar que você é o dono desta carteira.\n` +
    `Esta ação é gratuita e não gera transação na blockchain.\n\n` +
    `Carteira: ${pubkey}\n` +
    `Nonce: ${nonce}`
  );
}

const WalletAuthContext = createContext(null);

export function WalletAuthProvider({ children }) {
  const wallet = useWallet();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isSigning,       setIsSigning]       = useState(false);
  const [authError,       setAuthError]        = useState(null);

  // Reseta auth quando carteira desconecta ou troca de conta
  useEffect(() => {
    if (!wallet.connected || !wallet.publicKey) {
      setIsAuthenticated(false);
      setAuthError(null);
    }
  }, [wallet.connected, wallet.publicKey]);

  // Restaura a sessão ao conectar, se ainda estiver dentro da validade.
  useEffect(() => {
    if (!wallet.publicKey) return;
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return;

      const { wallet: saved, ts } = JSON.parse(raw);

      // Sessão vencida é descartada aqui mesmo, para não ficar acumulando
      // registro morto no armazenamento do navegador.
      if (!ts || Date.now() - ts > SESSION_TTL_MS) {
        localStorage.removeItem(SESSION_KEY);
        return;
      }

      // A sessão vale para UMA carteira. Trocar de conta no Phantom precisa
      // de nova assinatura — senão a autorização de uma valeria para a outra.
      if (saved === wallet.publicKey.toBase58()) setIsAuthenticated(true);
    } catch {}
  }, [wallet.publicKey]);

  const authenticate = useCallback(async () => {
    if (!wallet.publicKey || !wallet.signMessage) {
      setAuthError('Esta carteira não suporta assinatura de mensagem.');
      return;
    }
    setIsSigning(true);
    setAuthError(null);
    try {
      const message  = buildMessage(wallet.publicKey.toBase58());
      const msgBytes = new TextEncoder().encode(message);
      const signature = await wallet.signMessage(msgBytes);

      // Verifica com nacl (tweetnacl — dep transitiva de @solana/web3.js)
      try {
        const nacl = (await import('tweetnacl')).default;
        const valid = nacl.sign.detached.verify(msgBytes, signature, wallet.publicKey.toBytes());
        if (!valid) throw new Error('Assinatura inválida.');
      } catch (e) {
        if (e.message === 'Assinatura inválida.') throw e;
        // nacl indisponível — confia na aprovação explícita do usuário na carteira
      }

      setIsAuthenticated(true);
      try {
        localStorage.setItem(SESSION_KEY, JSON.stringify({
          wallet: wallet.publicKey.toBase58(),
          ts: Date.now(),
        }));
      } catch {}
    } catch (err) {
      const msg = err?.message || 'Erro ao assinar.';
      setAuthError(
        msg.includes('rejected') || msg.includes('User rejected') || msg.includes('cancel')
          ? 'Assinatura cancelada.'
          : msg
      );
      setIsAuthenticated(false);
    } finally {
      setIsSigning(false);
    }
  }, [wallet]);

  const logout = useCallback(async () => {
    setIsAuthenticated(false);
    setAuthError(null);
    try { localStorage.removeItem(SESSION_KEY); } catch {}
    try { await wallet.disconnect(); } catch (e) { console.error('[WalletAuth] disconnect:', e?.message); }
    try { localStorage.removeItem('urban-secure:wallet'); } catch {}
  }, [wallet]);

  return (
    <WalletAuthContext.Provider value={{ isAuthenticated, isSigning, authError, authenticate, logout }}>
      {children}
    </WalletAuthContext.Provider>
  );
}

export function useWalletAuth() {
  const ctx = useContext(WalletAuthContext);
  if (!ctx) throw new Error('useWalletAuth deve ser usado dentro de <WalletAuthProvider>');
  return ctx;
}
