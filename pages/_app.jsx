import { useState, useEffect, useMemo } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { clusterApiUrl } from '@solana/web3.js';
import { ArtsProvider } from '../context/ArtsContext';

import '@solana/wallet-adapter-react-ui/styles.css';
import '../styles/globals.css';

function Providers({ children }) {
  const network = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet';
  const endpoint = useMemo(() => clusterApiUrl(network), [network]);
  const wallets = useMemo(() => [new PhantomWalletAdapter()], []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider
        wallets={wallets}
        autoConnect={false}
        localStorageKey="urban-secure:wallet"
        onError={(e) => console.error('[WalletProvider]', e?.message, e?.error?.message)}
      >
        <WalletModalProvider>
          <ArtsProvider>{children}</ArtsProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

export default function App({ Component, pageProps }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return <Providers><Component {...pageProps} /></Providers>;
}
