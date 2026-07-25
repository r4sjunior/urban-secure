import { useState, useEffect, useMemo } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { clusterApiUrl } from '@solana/web3.js';
import { ArtsProvider } from '../context/ArtsContext';
import { WalletAuthProvider } from '../context/WalletAuthContext';
import { ProfileProvider } from '../context/ProfileContext';
import { ClaimProvider } from '../context/ClaimContext';
import { ThemeProvider } from '../context/ThemeContext';
import { GeoProvider } from '../context/GeoContext';

import '@solana/wallet-adapter-react-ui/styles.css';
import '../styles/globals.css';

/**
 * `autoConnect` LIGADO — revertendo uma tentativa anterior de desligá-lo.
 *
 * Eu o desliguei para resolver "meu perfil aparece antes de eu conectar", e
 * a cura foi pior que a doença: sem reconexão automática, a carteira caía a
 * cada recarregamento, e o usuário tinha que conectar E ASSINAR de novo toda
 * vez que voltava uma tela. Trocar um incômodo cosmético por atrito
 * constante numa ação que envolve carteira é um mau negócio.
 *
 * O adaptador só reconecta quem JÁ autorizou este site antes — não há
 * conexão silenciosa de carteira desconhecida. Junto com a sessão de 7 dias
 * (context/WalletAuthContext.jsx), o usuário recorrente entra sem assinar.
 *
 * Quem quiser sair de verdade usa "Sair", que limpa a sessão e desconecta.
 */
const AUTO_CONNECT = true;

function Providers({ children }) {
  const network = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet';
  const endpoint = useMemo(() => clusterApiUrl(network), [network]);
  const wallets = useMemo(() => [new PhantomWalletAdapter()], []);

  return (
    <ThemeProvider>
      {/* GeoProvider por fora de tudo: o rastreio de posição não depende de
          carteira nem de dados, e precisa sobreviver à navegação entre telas
          — era o que fazia o app repedir GPS a cada ida e volta. */}
      <GeoProvider>
      <ConnectionProvider endpoint={endpoint}>
        <WalletProvider
          wallets={wallets}
          autoConnect={AUTO_CONNECT}
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
      </GeoProvider>
    </ThemeProvider>
  );
}

export default function App({ Component, pageProps }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return <Providers><Component {...pageProps} /></Providers>;
}
