/**
 * components/CollectButton.jsx
 * Botão de "coletar" — paga o artista original (0,0012 SOL por padrão) e
 * minta uma EDIÇÃO da obra na carteira de quem coleta (não move o NFT
 * original, não cria pino novo no mapa). Só funciona nas primeiras 24h
 * depois do registro da obra.
 *
 * Depois das 24h, a coleta padrão fecha e viram disponíveis lances em
 * múltiplos fixos do preço base (5x/10x/20x/50x) — compra instantânea no
 * valor do tier escolhido, sem disputa entre lances.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { payForCollect, getCollectPriceSol, COLLECT_TIERS } from '../lib/collectPayment';
import { uploadJson, mintNft } from '../lib/mint';
import { safeJson } from '../lib/safeJson';

const COLLECT_WINDOW_MS = 20 * 1000; // TESTE QA TEMPORARIO — reverter para 24h antes de mergear

function formatRemaining(ms) {
  if (ms <= 0) return null;
  const totalMin = Math.ceil(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h < 1) return `${m}min restantes`;
  return `${h}h ${m}min restantes`;
}

export default function CollectButton({ art, initialCount = 0, wallet: injectedWallet, isAuthenticated = false }) {
  const contextWallet = useWallet();
  const wallet = injectedWallet || contextWallet;
  const [count, setCount] = useState(initialCount);
  const [loading, setLoading] = useState(false);
  const [pendingTier, setPendingTier] = useState(null);
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const isOwnPost = wallet.publicKey && art.artistWallet === wallet.publicKey.toBase58();
  const deadline = (art.timestamp || 0) + COLLECT_WINDOW_MS;
  const remainingMs = deadline - now;
  const expired = remainingMs <= 0;

  // Atualiza o contador ao vivo enquanto a janela de 24h não expira
  useEffect(() => {
    if (expired) return;
    const id = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(id);
  }, [expired]);

  useEffect(() => {
    let active = true;
    fetch(`/api/collects?postId=${encodeURIComponent(art.id)}`)
      .then(r => r.json())
      .then(data => { if (active) setCount(data.count ?? initialCount); })
      .catch(() => {});
    return () => { active = false; };
  }, [art.id, initialCount]);

  const remainingLabel = useMemo(() => formatRemaining(remainingMs), [remainingMs]);

  const handleCollect = useCallback(async (tier) => {
    setError(null); setOk(false);

    if (!wallet.connected || !wallet.publicKey) { setError('Conecte sua carteira para coletar.'); return; }
    if (!isAuthenticated) { setError('Assine na carteira para coletar.'); return; }
    if (isOwnPost) { setError('Você não pode coletar a própria obra.'); return; }
    if (tier === 1 && expired) { setError('Coleta padrão expirada — escolha um lance.'); return; }
    if (tier !== 1 && !expired) { setError('Lance só disponível após a coleta padrão expirar.'); return; }

    setLoading(true); setPendingTier(tier);
    try {
      const tx = await payForCollect(wallet, art.artistWallet, tier);

      const isBid = tier !== 1;
      const metadata = {
        name: isBid ? `${art.name} — Edição Coletada (Lance ${tier}x)` : `${art.name} — Edição Coletada`,
        symbol: 'URBAN',
        description: art.description,
        image: art.imageUrl,
        seller_fee_basis_points: 500,
        attributes: [
          { trait_type: 'Latitude',   value: String(art.lat) },
          { trait_type: 'Longitude',  value: String(art.lng) },
          { trait_type: 'Categoria',  value: 'Arte Urbana — Edição' },
          { trait_type: 'Edição de',  value: art.id },
          ...(isBid ? [{ trait_type: 'Lance', value: `${tier}x` }] : []),
        ],
        properties: {
          category: 'image',
          files: [{ uri: art.imageUrl, type: 'image/jpeg' }],
          creators: [{ address: art.artistWallet, share: 100 }],
        },
      };
      const metadataUri = await uploadJson(metadata);
      const editionMintId = await mintNft({ wallet, metadataUri, name: metadata.name });

      const r = await fetch('/api/collects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId: art.id, wallet: wallet.publicKey.toBase58(), tx, editionMintId, tier }),
      });
      const data = await safeJson(r);
      if (!r.ok) throw new Error(data.error || 'Falha ao registrar coleta.');

      setOk(true);
      setCount(data.count ?? (count + 1));
    } catch (err) {
      console.error('[CollectButton]', err);
      let msg = err.message || 'Erro ao coletar.';
      if (msg.includes('insufficient') || msg.includes('0x1')) msg = 'Saldo insuficiente para coletar.';
      else if (msg.includes('rejected') || msg.includes('User rejected')) msg = 'Transação cancelada na carteira.';
      setError(msg);
    } finally {
      setLoading(false); setPendingTier(null);
    }
  }, [wallet, isOwnPost, expired, isAuthenticated, art, count]);

  const disabledBase = loading || isOwnPost;

  return (
    <div className="collect-button-wrap">
      {!expired ? (
        <button
          className={`collect-btn ${ok ? 'collected' : ''}`}
          onClick={() => handleCollect(1)}
          disabled={disabledBase}
          title={
            !wallet.connected  ? 'Conecte sua carteira para coletar' :
            !isAuthenticated   ? 'Assine na carteira para coletar' :
            isOwnPost          ? 'Você não pode coletar a própria obra' :
            `Coletar por ${getCollectPriceSol()} SOL + gás`
          }
        >
          {loading ? '⏳' : ok ? '✅' : '🪙'} {count > 0 && count}
        </button>
      ) : (
        <div className="collect-tiers">
          <span className="collect-tiers-label">⌛ Coleta padrão encerrada — dar lance:</span>
          <div className="collect-tiers-row">
            {COLLECT_TIERS.map(t => (
              <button
                key={t}
                className="collect-tier-btn"
                onClick={() => handleCollect(t)}
                disabled={disabledBase}
                title={
                  !wallet.connected  ? 'Conecte sua carteira para dar lance' :
                  !isAuthenticated   ? 'Assine na carteira para dar lance' :
                  isOwnPost          ? 'Você não pode dar lance na própria obra' :
                  `Coletar por ${getCollectPriceSol(t)} SOL + gás`
                }
              >
                {loading && pendingTier === t ? '⏳' : `${t}×`}
              </button>
            ))}
          </div>
          {count > 0 && <span className="collect-count-label">🪙 {count} coletados</span>}
        </div>
      )}
      {error && <div className="like-error">⚠️ {error}</div>}
      {!expired && !ok && <span className="like-price">{getCollectPriceSol()} SOL + gás do mint</span>}
      {!expired && remainingLabel && <span className="collect-countdown">{remainingLabel}</span>}
    </div>
  );
}
