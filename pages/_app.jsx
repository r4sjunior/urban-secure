import { useState, useEffect, useMemo } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare';
import { clusterApiUrl } from '@solana/web3.js';
import { ArtsProvider } from '../context/ArtsContext';

import '@solana/wallet-adapter-react-ui/styles.css';
import '../styles/globals.css';

function WalletProviders({ children }) {
  const network  = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet';
  const endpoint = useMemo(() => clusterApiUrl(network), [network]);
  const wallets  = useMemo(() => [
    new PhantomWalletAdapter(),
    new SolflareWalletAdapter(),
  ], []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider
        wallets={wallets}
        autoConnect={false}
        localStorageKey="urban-secure:wallet"
        onError={err => console.error('[WalletProvider]', err?.message, err?.error?.message)}
      >
        <WalletModalProvider>
          {/* ArtsProvider fica dentro do WalletProvider para acessar useWallet() */}
          <ArtsProvider>
            {children}
          </ArtsProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

export default function App({ Component, pageProps }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return (
    <WalletProviders>
      <Component {...pageProps} />
    </WalletProviders>
  );
}
