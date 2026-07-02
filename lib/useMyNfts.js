/**
 * lib/useMyNfts.js
 * Busca os NFTs URBAN (symbol === 'URBAN') da carteira conectada, com a
 * imagem e descrição resolvidas do metadata JSON. Usado por TransferModal
 * e MarketModal.
 */
import { useState, useEffect, useCallback } from 'react';

export function useMyNfts(wallet, active) {
  const [nfts, setNfts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!active || !wallet.publicKey) return;
    let cancel = false;
    (async () => {
      setLoading(true);
      try {
        const { createUmi } = await import('@metaplex-foundation/umi-bundle-defaults');
        const { walletAdapterIdentity } = await import('@metaplex-foundation/umi-signer-wallet-adapters');
        const { mplTokenMetadata, fetchAllDigitalAssetWithTokenByOwner } = await import('@metaplex-foundation/mpl-token-metadata');

        const umi = createUmi(`${window.location.origin}/api/rpc`)
          .use(walletAdapterIdentity(wallet)).use(mplTokenMetadata());

        const assets = await fetchAllDigitalAssetWithTokenByOwner(umi, wallet.publicKey);
        const urbanAssets = assets.filter(a => (a.metadata.symbol || '').trim() === 'URBAN');

        const urban = await Promise.all(urbanAssets.map(async (a) => {
          let imageUrl = '', description = '';
          try {
            const res = await fetch(a.metadata.uri);
            const json = await res.json();
            imageUrl = (json.image || '').startsWith('https://') ? json.image : '';
            description = json.description || '';
          } catch {}
          return { id: a.publicKey.toString(), name: a.metadata.name, uri: a.metadata.uri, imageUrl, description };
        }));
        if (!cancel) setNfts(urban);
      } catch (err) {
        console.error('[useMyNfts]', err);
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [active, wallet.publicKey, reloadKey]);

  const removeNft = useCallback((id) => {
    setNfts(prev => prev.filter(n => n.id !== id));
  }, []);

  const reload = useCallback(() => setReloadKey(k => k + 1), []);

  return { nfts, loading, removeNft, reload };
}
