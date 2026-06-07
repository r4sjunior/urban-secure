/**
 * components/WalletHandler.jsx
 * Conexão de wallet — APENAS Phantom. Controle explícito de connect/disconnect.
 */
import { useEffect, useState, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletReadyState } from '@solana/wallet-adapter-base';

function isMobile() {
  if (typeof window === 'undefined') return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}
function inPhantom() { return typeof window !== 'undefined' && !!window.phantom?.solana?.isPhantom; }
function phantomLink() {
  return `https://phantom.app/ul/v1/browse/${encodeURIComponent(typeof window !== 'undefined' ? window.location.href : '')}`;
}

export default function WalletHandler() {
  const { wallets, wallet, publicKey, connected, connecting, select, connect, disconnect } = useWallet();
  const [env, setEnv] = useState('unknown');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (inPhantom())  { setEnv('phantom-browser'); return; }
    if (isMobile())   { setEnv('mobile');          return; }
    setEnv('desktop');
  }, []);

  // Listeners de erro
  useEffect(() => {
    if (!wallets?.length) return;
    const subs = wallets.map(w => {
      const onErr = (e) => { console.error(`[Wallet] ${w.adapter.name}:`, e?.message); setBusy(false); };
      w.adapter.on('error', onErr);
      return () => w.adapter.off('error', onErr);
    });
    return () => subs.forEach(fn => fn());
  }, [wallets]);

  const phantomAdapter = wallets?.find(w => w.adapter.name === 'Phantom');
  const phantomReady = phantomAdapter?.adapter.readyState === WalletReadyState.Installed
                    || phantomAdapter?.adapter.readyState === WalletReadyState.Loadable;

  // Conecta: seleciona Phantom e conecta explicitamente
  const handleConnect = useCallback(async () => {
    try {
      setBusy(true);
      // Se o Phantom não está injetado no browser, manda pro deep link
      if (env === 'mobile' && !inPhantom() && !phantomReady) {
        window.location.href = phantomLink();
        return;
      }
      if (wallet?.adapter?.name !== 'Phantom') {
        select('Phantom');
        // espera o adapter ser selecionado antes de conectar
        await new Promise(r => setTimeout(r, 300));
      }
      await connect();
    } catch (e) {
      console.error('[Wallet] connect:', e?.message);
    } finally {
      setBusy(false);
    }
  }, [env, phantomReady, wallet, select, connect]);

  // Desconecta e limpa o estado salvo (evita auto-reconexão)
  const handleDisconnect = useCallback(async () => {
    try {
      await disconnect();
    } catch (e) {
      console.error('[Wallet] disconnect:', e?.message);
    } finally {
      // Garante limpeza da chave persistida
      try { localStorage.removeItem('urban-secure:wallet'); } catch {}
    }
  }, [disconnect]);

  // Auto-connect só dentro do browser interno da Phantom
  useEffect(() => {
    if (connected || busy) return;
    if (env !== 'phantom-browser') return;
    if (!phantomReady) return;
    select('Phantom');
    const t = setTimeout(() => connect().catch(e => console.error('[Wallet] auto:', e?.message)), 300);
    return () => clearTimeout(t);
  }, [env, connected, phantomReady]);

  // CONECTADO
  if (connected && publicKey) {
    return (
      <div className="wallet-connected">
        <div className="wallet-badge">
          <span className="wallet-dot" />
          <span className="wallet-pub">{publicKey.toBase58().slice(0,4)}…{publicKey.toBase58().slice(-4)}</span>
        </div>
        <button className="wallet-disconnect" onClick={handleDisconnect}>Sair</button>
      </div>
    );
  }

  // CONECTANDO
  if (connecting || busy) {
    return <button className="wallet-connect-btn" disabled>Conectando…</button>;
  }

  // DESCONECTADO → botão conectar
  return (
    <button className="wallet-connect-btn" onClick={handleConnect}>
      👻 Conectar Phantom
    </button>
  );
}
