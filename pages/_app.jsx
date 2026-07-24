import { useState, useEffect, useMemo } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { clusterApiUrl } from '@solana/web3.js';
import { ArtsProvider } from '../context/ArtsContext';
import { WalletAuthProvider } from '../context/WalletAuthContext';
import { ProfileProvider } from '../context/ProfileContext';
import { ClaimProvider } from '../context/ClaimContext';

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
        autoConnect
        localStorageKey="urban-secure:wallet"
        onError={(e) => console.error('[WalletProvider]', e?.message, e?.error?.message)}
      >
        <WalletModalProvider>
          <WalletAuthProvider>
            {/* ProfileProvider por fora do ArtsProvider: o perfil depende só
                da carteira conectada, enquanto o mapa de artes é pesado e
                recarrega sozinho. Invertida, toda atualização do registry
                arrastaria o perfil junto. */}
            <ProfileProvider>
              {/* ClaimProvider dentro do ProfileProvider: o sheet do claim
                  dispara refresh do perfil ao resgatar (streak e ranking
                  mudam), então precisa enxergar aquele contexto. */}
              <ClaimProvider>
                <ArtsProvider>{children}</ArtsProvider>
              </ClaimProvider>
            </ProfileProvider>
          </WalletAuthProvider>
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
