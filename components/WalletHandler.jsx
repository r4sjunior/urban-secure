/**
 * components/WalletHandler.jsx
 * Conexão de wallet — APENAS Phantom. Suporte a mobile (deep link) e desconectar.
 */
import { useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
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
  const wallet = useWallet();
  const [env, setEnv] = useState('unknown');

  useEffect(() => {
    if (inPhantom())  { setEnv('phantom-browser'); return; }
    if (isMobile())   { setEnv('mobile');          return; }
    setEnv('desktop');
  }, []);

  useEffect(() => {
    if (!wallet.wallets?.length) return;
    const subs = wallet.wallets.map(w => {
      const onErr = (e) => console.error(`[Wallet] ${w.adapter.name}:`, e?.message);
      w.adapter.on('error', onErr);
      return () => w.adapter.off('error', onErr);
    });
    return () => subs.forEach(fn => fn());
  }, [wallet.wallets]);

  // Auto-connect dentro do browser interno da Phantom
  useEffect(() => {
    if (wallet.connected) return;
    if (env !== 'phantom-browser') return;
    const found = wallet.wallets?.find(w => w.adapter.name === 'Phantom' && w.adapter.readyState === WalletReadyState.Installed);
    if (found) {
      wallet.select(found.adapter.name);
      const t = setTimeout(() => wallet.connect().catch(e => console.error('[Wallet] auto:', e?.message)), 250);
      return () => clearTimeout(t);
    }
  }, [env, wallet.connected, wallet.wallets]);

  if (wallet.connected) {
    return (
      <div className="wallet-connected">
        <div className="wallet-badge">
          <span className="wallet-dot" />
          <span className="wallet-pub">{wallet.publicKey?.toBase58().slice(0,4)}…{wallet.publicKey?.toBase58().slice(-4)}</span>
        </div>
        <button className="wallet-disconnect" onClick={() => wallet.disconnect()}>Sair</button>
      </div>
    );
  }

  // Mobile fora do app Phantom → deep link abre dentro da Phantom
  if (env === 'mobile') {
    const hasInjected = wallet.wallets?.some(w => w.adapter.readyState === WalletReadyState.Installed);
    if (hasInjected) {
      return <div style={{ position:'relative', zIndex:10 }}><WalletMultiButton /></div>;
    }
    return (
      <div className="wallet-mobile">
        <a href={phantomLink()} className="deeplink phantom">👻 Conectar Phantom</a>
      </div>
    );
  }

  return <div style={{ position:'relative', zIndex:10 }}><WalletMultiButton /></div>;
}
