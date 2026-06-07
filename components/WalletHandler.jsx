/**
 * components/WalletHandler.jsx
 * Conexão de wallet via WalletMultiButton oficial (robusto) + desconexão limpa.
 */
import { useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';

function isMobile() {
  if (typeof window === 'undefined') return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}
function inPhantom() { return typeof window !== 'undefined' && !!window.phantom?.solana?.isPhantom; }
function phantomLink() {
  return `https://phantom.app/ul/v1/browse/${encodeURIComponent(typeof window !== 'undefined' ? window.location.href : '')}`;
}

export default function WalletHandler() {
  const { publicKey, connected, disconnect, wallet } = useWallet();
  const [isMobileBrowser, setIsMobileBrowser] = useState(false);

  useEffect(() => {
    // Mobile fora do app Phantom (sem wallet injetada) → precisa de deep link
    setIsMobileBrowser(isMobile() && !inPhantom());
  }, []);

  async function handleDisconnect() {
    try { await disconnect(); }
    catch (e) { console.error('[Wallet] disconnect:', e?.message); }
    finally { try { localStorage.removeItem('urban-secure:wallet'); } catch {} }
  }

  // Conectado → mostra endereço + Sair
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

  // Mobile sem Phantom injetado → deep link abre o app Phantom com o site dentro
  if (isMobileBrowser) {
    return (
      <a href={phantomLink()} className="wallet-connect-btn" style={{ textDecoration:'none' }}>
        👻 Abrir no Phantom
      </a>
    );
  }

  // Desktop ou dentro do Phantom → botão oficial (gerencia connect/modal sozinho)
  return (
    <div className="wallet-btn-wrap">
      <WalletMultiButton />
    </div>
  );
}
