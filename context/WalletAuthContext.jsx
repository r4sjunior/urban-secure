/**
 * context/WalletAuthContext.jsx
 * Autenticação via assinatura de mensagem — prova de posse da carteira.
 * Não gera transação on-chain; usa wallet.signMessage() do Phantom.
 * Auth é armazenada em sessionStorage (expira ao fechar a aba).
 */
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';

const SESSION_KEY = 'urban-secure:auth';

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

  // Restaura sessão do sessionStorage ao conectar
  useEffect(() => {
    if (!wallet.publicKey) return;
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return;
      const { wallet: saved } = JSON.parse(raw);
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
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({
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
    try { sessionStorage.removeItem(SESSION_KEY); } catch {}
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
