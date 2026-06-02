/**
 * components/WalletHandler.jsx
 *
 * Gerencia toda a lógica de conexão de wallet com suporte completo a mobile:
 *
 *  1. Listeners de erro em cada adaptador (console.error detalhado)
 *  2. Detecção de ambiente: desktop / mobile / in-app browser
 *  3. Deep links manuais para Phantom e Solflare no mobile
 *  4. Auto-conexão imediata quando detectado in-app browser da wallet
 *  5. useMemo verificado — adaptadores nunca são recriados
 */

import { useEffect, useState, useCallback } from 'react';
import { useWallet }                         from '@solana/wallet-adapter-react';
import { WalletMultiButton }                 from '@solana/wallet-adapter-react-ui';
import { WalletReadyState }                  from '@solana/wallet-adapter-base';

// ─── Detecção de ambiente ────────────────────────────────────

function isMobileDevice() {
  if (typeof window === 'undefined') return false;
  return /Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop/i.test(
    navigator.userAgent
  );
}

/**
 * Detecta se estamos dentro do browser embutido da Phantom.
 * Quando abrimos um link dentro do app Phantom, ele injeta
 * window.phantom.solana automaticamente.
 */
function isInsidePhantomBrowser() {
  if (typeof window === 'undefined') return false;
  return Boolean(window.phantom?.solana?.isPhantom);
}

/**
 * Detecta se estamos dentro do browser embutido da Solflare.
 */
function isInsideSolflareBrowser() {
  if (typeof window === 'undefined') return false;
  return Boolean(window.solflare?.isSolflare);
}

/**
 * Gera o deep link para abrir o dApp dentro do browser da Phantom.
 * O usuário já estará autenticado quando o app carregar dentro da Phantom.
 * Formato: https://phantom.app/ul/v1/browse/{encodedUrl}
 */
function phantomDeepLink() {
  const dappUrl = typeof window !== 'undefined' ? window.location.href : '';
  return `https://phantom.app/ul/v1/browse/${encodeURIComponent(dappUrl)}`;
}

/**
 * Gera o deep link para abrir o dApp dentro do browser da Solflare.
 * Formato: https://solflare.com/ul/v1/browse/{encodedUrl}
 */
function solflareDeepLink() {
  const dappUrl = typeof window !== 'undefined' ? window.location.href : '';
  return `https://solflare.com/ul/v1/browse/${encodeURIComponent(dappUrl)}`;
}

// ─── Componente ──────────────────────────────────────────────

export default function WalletHandler() {
  const wallet = useWallet();

  const [env, setEnv]             = useState('unknown');   // 'desktop' | 'phantom-browser' | 'solflare-browser' | 'mobile'
  const [adapterLogs, setLogs]    = useState([]);          // histórico de erros dos adaptadores
  const [connecting, setConnecting] = useState(false);

  // ── 1. Detecta ambiente ao montar ──────────────────────────
  useEffect(() => {
    if (isInsidePhantomBrowser())  { setEnv('phantom-browser');  return; }
    if (isInsideSolflareBrowser()) { setEnv('solflare-browser'); return; }
    if (isMobileDevice())          { setEnv('mobile');           return; }
    setEnv('desktop');
  }, []);

  // ── 2. Listeners de erro em todos os adaptadores ───────────
  useEffect(() => {
    if (!wallet.wallets?.length) return;

    const unsubs = wallet.wallets.map((w) => {
      const adapter = w.adapter;

      const onError = (error) => {
        const entry = {
          time:    new Date().toISOString(),
          wallet:  adapter.name,
          code:    error?.error?.code ?? 'N/A',
          message: error?.message ?? String(error),
        };
        console.error(`[WalletHandler] ${adapter.name} error:`, entry);
        setLogs((prev) => [entry, ...prev].slice(0, 10)); // mantém últimos 10
      };

      const onConnect = () => {
        console.log(`[WalletHandler] ${adapter.name} connected ✅`, {
          publicKey:  adapter.publicKey?.toBase58(),
          readyState: adapter.readyState,
        });
        setConnecting(false);
      };

      const onDisconnect = () => {
        console.warn(`[WalletHandler] ${adapter.name} disconnected`);
      };

      adapter.on('error',      onError);
      adapter.on('connect',    onConnect);
      adapter.on('disconnect', onDisconnect);

      return () => {
        adapter.off('error',      onError);
        adapter.off('connect',    onConnect);
        adapter.off('disconnect', onDisconnect);
      };
    });

    return () => unsubs.forEach((fn) => fn());
  }, [wallet.wallets]);

  // ── 3. Auto-conexão quando estamos dentro do browser da wallet ──
  useEffect(() => {
    if (wallet.connected) return;
    if (connecting)       return;

    if (env === 'phantom-browser' || env === 'solflare-browser') {
      const targetName = env === 'phantom-browser' ? 'Phantom' : 'Solflare';
      const found = wallet.wallets?.find(
        (w) => w.adapter.name === targetName &&
               w.adapter.readyState === WalletReadyState.Installed
      );

      if (found) {
        console.log(`[WalletHandler] In-app browser (${targetName}) — conectando…`);
        setConnecting(true);
        // select() é síncrono mas connect() precisa esperar o próximo tick
        // para o adapter selecionado estar ativo
        wallet.select(found.adapter.name);
        const timer = setTimeout(() => {
          wallet.connect().catch((err) => {
            console.error('[WalletHandler] Auto-connect falhou:', err?.message);
            setConnecting(false);
          });
        }, 250);
        return () => clearTimeout(timer);
      }
    }
  }, [env, wallet.connected, wallet.wallets]);

  // ── 4. Log do readyState de cada adaptador ─────────────────
  useEffect(() => {
    if (!wallet.wallets?.length) return;
    console.group('[WalletHandler] Adapter ready states');
    wallet.wallets.forEach((w) => {
      console.log(`  ${w.adapter.name}: ${w.adapter.readyState}`);
    });
    console.groupEnd();
  }, [wallet.wallets]);

  // ─── Render ────────────────────────────────────────────────

  // Desktop ou já dentro da wallet → usa o botão padrão do adapter
  if (env === 'desktop' || env === 'phantom-browser' || env === 'solflare-browser') {
    return (
      <div style={{ position: 'relative', zIndex: 10 }}>
        <WalletMultiButton />
        {connecting && (
          <p style={{ fontSize: 11, color: '#69f0ae', textAlign: 'center', marginTop: 4 }}>
            Conectando automaticamente…
          </p>
        )}
        {wallet.connected && (
          <div className="wallet-connected-badge">
            ✅ {wallet.wallet?.adapter?.name} conectado
            <span className="wallet-pubkey">
              {wallet.publicKey?.toBase58().slice(0, 8)}…
            </span>
          </div>
        )}
        <WalletErrorLog logs={adapterLogs} />
      </div>
    );
  }

  // Mobile fora de in-app browser → mostra deep links + botão padrão
  if (env === 'mobile') {
    // Se a wallet já está instalada no mobile (ex: Trust Wallet com browser embutido)
    const hasInjectedWallet = wallet.wallets?.some(
      (w) => w.adapter.readyState === WalletReadyState.Installed
    );

    if (wallet.connected) {
      return (
        <div className="wallet-connected-badge">
          ✅ {wallet.wallet?.adapter?.name} conectado
          <span className="wallet-pubkey">
            {wallet.publicKey?.toBase58().slice(0, 8)}…
          </span>
        </div>
      );
    }

    return (
      <div className="wallet-mobile-block">
        {/* Tenta o botão padrão primeiro — funciona em browsers com extensão */}
        {hasInjectedWallet && (
          <div style={{ position: 'relative', zIndex: 10 }}>
            <WalletMultiButton />
          </div>
        )}

        <p className="wallet-mobile-label">
          Abra este app <strong>dentro do navegador da carteira:</strong>
        </p>

        {/* Deep link Phantom */}
        <a
          href={phantomDeepLink()}
          className="wallet-deeplink-btn phantom"
          rel="noreferrer"
        >
          <img
            src="https://phantom.app/img/phantom-logo.svg"
            alt="Phantom"
            style={{ width: 22, height: 22, borderRadius: 4, flexShrink: 0 }}
            onError={(e) => { e.target.style.display = 'none'; }}
          />
          Abrir com Phantom
        </a>

        {/* Deep link Solflare */}
        <a
          href={solflareDeepLink()}
          className="wallet-deeplink-btn solflare"
          rel="noreferrer"
        >
          <img
            src="https://solflare.com/favicon.ico"
            alt="Solflare"
            style={{ width: 22, height: 22, borderRadius: 4, flexShrink: 0 }}
            onError={(e) => { e.target.style.display = 'none'; }}
          />
          Abrir com Solflare
        </a>

        <p className="wallet-hint" style={{ textAlign: 'center', marginTop: 4 }}>
          Não tem a carteira?{' '}
          <a href="https://phantom.app" target="_blank" rel="noreferrer">Baixar Phantom ↗</a>
        </p>

        <WalletErrorLog logs={adapterLogs} />
      </div>
    );
  }

  // Estado inicial (SSR / unknown) — renderiza botão padrão
  return (
    <div style={{ position: 'relative', zIndex: 10 }}>
      <WalletMultiButton />
    </div>
  );
}

// ─── Sub-componente: log de erros visível na tela (debug) ────
function WalletErrorLog({ logs }) {
  if (!logs.length) return null;
  return (
    <details style={{ marginTop: 6 }}>
      <summary style={{ fontSize: 10, color: '#ef5350', cursor: 'pointer' }}>
        ⚠️ {logs.length} erro(s) de wallet (clique para ver)
      </summary>
      <div style={{
        background: '#1a0000', borderRadius: 8, padding: 8, marginTop: 4,
        fontSize: 10, fontFamily: 'monospace', color: '#ef9a9a',
        maxHeight: 120, overflowY: 'auto',
      }}>
        {logs.map((l, i) => (
          <div key={i} style={{ marginBottom: 4 }}>
            [{l.time.slice(11, 19)}] {l.wallet} — {l.message}
            {l.code !== 'N/A' && ` (code: ${l.code})`}
          </div>
        ))}
      </div>
    </details>
  );
}
