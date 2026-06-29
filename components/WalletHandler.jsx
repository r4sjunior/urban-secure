/**
 * components/WalletHandler.jsx
 * Conexão Solana/Phantom + autenticação por assinatura de mensagem.
 * Fluxo: Conectar → Assinar (auto-prompt) → Autenticado.
 */
import { useEffect, useState, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletReadyState } from '@solana/wallet-adapter-base';
import { useWalletAuth } from '../context/WalletAuthContext';

function isMobile() {
  if (typeof window === 'undefined') return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}
function inPhantomBrowser() {
  return typeof window !== 'undefined' && !!window.phantom?.solana?.isPhantom;
}
function phantomDeepLink() {
  const url = typeof window !== 'undefined' ? window.location.href : '';
  return `https://phantom.app/ul/v1/browse/${encodeURIComponent(url)}?ref=urban-secure`;
}

export default function WalletHandler() {
  const { wallets, wallet, publicKey, connected, connecting, select, connect } = useWallet();
  const { isAuthenticated, isSigning, authError, authenticate, logout } = useWalletAuth();
  const [busy,   setBusy]   = useState(false);
  const [mobile, setMobile] = useState(false);

  useEffect(() => { setMobile(isMobile()); }, []);

  const phantom    = wallets?.find(w => w.adapter.name === 'Phantom');
  const ready      = phantom?.adapter.readyState;
  const isInstalled = ready === WalletReadyState.Installed || ready === WalletReadyState.Loadable;

  const handleConnect = useCallback(async () => {
    if (mobile && !inPhantomBrowser() && !isInstalled) {
      window.location.href = phantomDeepLink();
      return;
    }
    if (!isInstalled && !inPhantomBrowser()) {
      window.open('https://phantom.app/download', '_blank', 'noopener');
      return;
    }
    try {
      setBusy(true);
      if (wallet?.adapter?.name !== 'Phantom') {
        select('Phantom');
        await new Promise(r => setTimeout(r, 250));
      }
      await connect();
    } catch (e) {
      console.error('[Wallet] connect:', e?.message);
    } finally {
      setBusy(false);
    }
  }, [mobile, isInstalled, wallet, select, connect]);

  // ── AUTENTICADO ─────────────────────────────────────────────
  if (connected && publicKey && isAuthenticated) {
    const addr = publicKey.toBase58();
    return (
      <div className="wallet-connected">
        <div className="wallet-badge">
          <span className="wallet-dot" />
          <span className="wallet-pub">{addr.slice(0,4)}…{addr.slice(-4)}</span>
        </div>
        <button className="wallet-disconnect" onClick={logout}>Sair</button>
      </div>
    );
  }

  // ── ASSINANDO (auto-prompt ou manual) ───────────────────────
  if (connected && publicKey && isSigning) {
    return (
      <button className="wallet-connect-btn wallet-sign-btn" disabled>
        ✍️ Assinando na carteira…
      </button>
    );
  }

  // ── CONECTADO mas aguardando assinatura ──────────────────────
  if (connected && publicKey) {
    return (
      <div className="wallet-auth-wrap">
        {authError && <span className="wallet-auth-err">⚠️ {authError}</span>}
        <button className="wallet-connect-btn wallet-sign-btn" onClick={authenticate}>
          ✍️ Assinar para entrar
        </button>
      </div>
    );
  }

  // ── CONECTANDO ───────────────────────────────────────────────
  if (connecting || busy) {
    return <button className="wallet-connect-btn" disabled>Conectando…</button>;
  }

  // ── DESCONECTADO ─────────────────────────────────────────────
  let label = '👻 Conectar Phantom';
  if (!isInstalled && !inPhantomBrowser()) {
    label = mobile ? '👻 Abrir no Phantom' : '👻 Instalar Phantom';
  }
  return (
    <button className="wallet-connect-btn" onClick={handleConnect}>{label}</button>
  );
}
