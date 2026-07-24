/**
 * lib/useMyNfts.js
 * Busca as artes URBAN (symbol === 'URBAN') da carteira conectada, com imagem
 * e descrição resolvidas do metadata JSON. Usado pelo TransferModal.
 *
 * Consulta os DOIS padrões: as artes novas são Metaplex Core, o acervo
 * anterior é Token Metadata. Buscar só um deles esconderia metade das obras
 * do próprio usuário na hora de enviar ou anunciar — ele veria a coleção
 * incompleta sem entender por quê.
 *
 * Usa as buscas por owner de cada programa (getProgramAccounts /
 * getTokenAccountsByOwner) em vez do DAS de propósito: em devnet o indexador
 * do Helius não cobre tudo, e estas leituras funcionam nas duas redes.
 */
import { useState, useEffect, useCallback } from 'react';
import { STANDARD_CORE, STANDARD_TOKEN_METADATA } from './solana/standard';

/** Resolve imagem e descrição do JSON off-chain. Falha vira campo vazio — a
 *  obra ainda aparece na lista, só sem miniatura. */
async function resolveMetadata(uri) {
  try {
    const res = await fetch(uri);
    const json = await res.json();
    return {
      imageUrl: (json.image || '').startsWith('https://') ? json.image : '',
      description: json.description || '',
      symbol: (json.symbol || '').trim(),
    };
  } catch {
    return { imageUrl: '', description: '', symbol: '' };
  }
}

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
        const { mplCore, fetchAssetsByOwner } = await import('@metaplex-foundation/mpl-core');

        const rpcUrl = `${window.location.origin}/api/rpc`;
        const umi = createUmi(rpcUrl).use(walletAdapterIdentity(wallet));

        // Falha de um padrão não pode derrubar o outro: se o Core estiver
        // indisponível, o usuário ainda precisa enxergar o acervo antigo.
        const [legacyResult, coreResult] = await Promise.allSettled([
          fetchAllDigitalAssetWithTokenByOwner(umi.use(mplTokenMetadata()), wallet.publicKey),
          fetchAssetsByOwner(umi.use(mplCore()), wallet.publicKey, { skipDerivePlugins: true }),
        ]);

        if (legacyResult.status === 'rejected') console.error('[useMyNfts] token-metadata:', legacyResult.reason?.message);
        if (coreResult.status === 'rejected') console.error('[useMyNfts] core:', coreResult.reason?.message);

        // Token Metadata carrega o symbol on-chain; dá pra filtrar antes de
        // buscar o JSON e evitar um request por NFT de terceiros na carteira.
        const legacy = (legacyResult.value || [])
          .filter(a => (a.metadata.symbol || '').trim() === 'URBAN')
          .map(a => ({
            id: a.publicKey.toString(),
            name: a.metadata.name,
            uri: a.metadata.uri,
            standard: STANDARD_TOKEN_METADATA,
          }));

        // Core não guarda symbol on-chain — só name e uri. O filtro por URBAN
        // precisa acontecer depois de ler o JSON off-chain.
        const core = (coreResult.value || []).map(a => ({
          id: a.publicKey.toString(),
          name: a.name,
          uri: a.uri,
          standard: STANDARD_CORE,
        }));

        const resolved = await Promise.all(
          [...legacy, ...core].map(async (item) => {
            const meta = await resolveMetadata(item.uri);
            return { ...item, ...meta };
          })
        );

        // Descarta os assets Core que não são do app. Os Token Metadata já
        // vieram filtrados pelo symbol on-chain, então passam direto.
        const urban = resolved.filter(
          n => n.standard === STANDARD_TOKEN_METADATA || n.symbol === 'URBAN'
        );

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
