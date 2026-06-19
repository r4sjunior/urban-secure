/**
 * components/WalletHandler.jsx
 * Conexão Solana/Phantom robusta: detecta readyState, conecta com fallback,
 * deep link no mobile, desconexão limpa.
 */
import { useEffect, useState, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletReadyState } from '@solana/wallet-adapter-base';

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
  const { wallets, wallet, publicKey, connected, connecting, select, connect, disconnect } = useWallet();
  const [busy, setBusy] = useState(false);
  const [mobile, setMobile] = useState(false);

  useEffect(() => { setMobile(isMobile()); }, []);

  // Encontra o adapter do Phantom e seu estado de prontidão
  const phantom = wallets?.find(w => w.adapter.name === 'Phantom');
  const ready = phantom?.adapter.readyState; // Installed | Loadable | NotDetected | Unsupported
  const isInstalled = ready === WalletReadyState.Installed || ready === WalletReadyState.Loadable;

  // Conecta com fallback de timing
  const handleConnect = useCallback(async () => {
    // Mobile sem Phantom injetado → abre dentro do app Phantom
    if (mobile && !inPhantomBrowser() && !isInstalled) {
      window.location.href = phantomDeepLink();
      return;
    }
    // Desktop sem extensão → manda instalar
    if (!isInstalled && !inPhantomBrowser()) {
      window.open('https://phantom.app/download', '_blank', 'noopener');
      return;
    }
    try {
      setBusy(true);
      if (wallet?.adapter?.name !== 'Phantom') {
        select('Phantom');
        await new Promise(r => setTimeout(r, 250)); // deixa o adapter ativar
      }
      await connect(); // dispara o popup do Phantom
    } catch (e) {
      console.error('[Wallet] connect:', e?.message);
    } finally {
      setBusy(false);
    }
  }, [mobile, isInstalled, wallet, select, connect]);

  const handleDisconnect = useCallback(async () => {
    try { await disconnect(); }
    catch (e) { console.error('[Wallet] disconnect:', e?.message); }
    finally { try { localStorage.removeItem('urban-secure:wallet'); } catch {} }
  }, [disconnect]);

  // CONECTADO
  if (connected && publicKey) {
    const addr = publicKey.toBase58();
    return (
      <div className="wallet-connected">
        <div className="wallet-badge">
          <span className="wallet-dot" />
          <span className="wallet-pub">{addr.slice(0,4)}…{addr.slice(-4)}</span>
        </div>
        <button className="wallet-disconnect" onClick={handleDisconnect}>Sair</button>
      </div>
    );
  }

  // CONECTANDO
  if (connecting || busy) {
    return <button className="wallet-connect-btn" disabled>Conectando…</button>;
  }

  // DESCONECTADO
  let label = '👻 Conectar Phantom';
  if (!isInstalled && !inPhantomBrowser()) {
    label = mobile ? '👻 Abrir no Phantom' : '👻 Instalar Phantom';
  }
  return (
    <button className="wallet-connect-btn" onClick={handleConnect}>{label}</button>
  );
}
