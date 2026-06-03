/**
 * components/WalletHandler.jsx
 * Conexão de wallet com suporte mobile (deep links) e in-app browser.
 */
import { useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { WalletReadyState } from '@solana/wallet-adapter-base';

function isMobile() {
  if (typeof window === 'undefined') return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}
function inPhantom()  { return typeof window !== 'undefined' && !!window.phantom?.solana?.isPhantom; }
function inSolflare() { return typeof window !== 'undefined' && !!window.solflare?.isSolflare; }

function phantomLink()  { return `https://phantom.app/ul/v1/browse/${encodeURIComponent(typeof window !== 'undefined' ? window.location.href : '')}`; }
function solflareLink() { return `https://solflare.com/ul/v1/browse/${encodeURIComponent(typeof window !== 'undefined' ? window.location.href : '')}`; }

export default function WalletHandler() {
  const wallet = useWallet();
  const [env, setEnv] = useState('unknown');

  useEffect(() => {
    if (inPhantom())  { setEnv('phantom-browser');  return; }
    if (inSolflare()) { setEnv('solflare-browser'); return; }
    if (isMobile())   { setEnv('mobile');           return; }
    setEnv('desktop');
  }, []);

  // Error listeners
  useEffect(() => {
    if (!wallet.wallets?.length) return;
    const subs = wallet.wallets.map(w => {
      const onErr = (e) => console.error(`[Wallet] ${w.adapter.name}:`, e?.message);
      w.adapter.on('error', onErr);
      return () => w.adapter.off('error', onErr);
    });
    return () => subs.forEach(fn => fn());
  }, [wallet.wallets]);

  // Auto-connect dentro do in-app browser
  useEffect(() => {
    if (wallet.connected) return;
    if (env !== 'phantom-browser' && env !== 'solflare-browser') return;
    const name = env === 'phantom-browser' ? 'Phantom' : 'Solflare';
    const found = wallet.wallets?.find(w => w.adapter.name === name && w.adapter.readyState === WalletReadyState.Installed);
    if (found) {
      wallet.select(found.adapter.name);
      const t = setTimeout(() => wallet.connect().catch(e => console.error('[Wallet] auto:', e?.message)), 250);
      return () => clearTimeout(t);
    }
  }, [env, wallet.connected, wallet.wallets]);

  if (wallet.connected) {
    return (
      <div className="wallet-badge">
        <span className="wallet-dot" />
        {wallet.wallet?.adapter?.name}
        <span className="wallet-pub">{wallet.publicKey?.toBase58().slice(0,4)}…{wallet.publicKey?.toBase58().slice(-4)}</span>
      </div>
    );
  }

  if (env === 'mobile') {
    const hasInjected = wallet.wallets?.some(w => w.adapter.readyState === WalletReadyState.Installed);
    return (
      <div className="wallet-mobile">
        {hasInjected && <div style={{ position:'relative', zIndex:10 }}><WalletMultiButton /></div>}
        <a href={phantomLink()} className="deeplink phantom">👻 Abrir no Phantom</a>
        <a href={solflareLink()} className="deeplink solflare">🔆 Abrir no Solflare</a>
      </div>
    );
  }

  return <div style={{ position:'relative', zIndex:10 }}><WalletMultiButton /></div>;
}
