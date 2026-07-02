/**
 * components/CollectButton.jsx
 * Botão de "coletar" — paga o artista original (0,0012 SOL por padrão) e
 * minta uma EDIÇÃO da obra na carteira de quem coleta (não move o NFT
 * original, não cria pino novo no mapa). Só funciona nas primeiras 24h
 * depois do registro da obra — depois disso fica "Expirado".
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { payForCollect, getCollectPriceSol } from '../lib/collectPayment';
import { uploadJson, mintNft } from '../lib/mint';

const COLLECT_WINDOW_MS = 24 * 60 * 60 * 1000;

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

  const handleCollect = useCallback(async () => {
    setError(null); setOk(false);

    if (!wallet.connected || !wallet.publicKey) { setError('Conecte sua carteira para coletar.'); return; }
    if (!isAuthenticated) { setError('Assine na carteira para coletar.'); return; }
    if (isOwnPost) { setError('Você não pode coletar a própria obra.'); return; }
    if (expired) { setError('Janela de coleta expirada (24h).'); return; }

    setLoading(true);
    try {
      const tx = await payForCollect(wallet, art.artistWallet);

      const metadata = {
        name: `${art.name} — Edição Coletada`,
        symbol: 'URBAN',
        description: art.description,
        image: art.imageUrl,
        seller_fee_basis_points: 500,
        attributes: [
          { trait_type: 'Latitude',   value: String(art.lat) },
          { trait_type: 'Longitude',  value: String(art.lng) },
          { trait_type: 'Categoria',  value: 'Arte Urbana — Edição' },
          { trait_type: 'Edição de',  value: art.id },
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
        body: JSON.stringify({ postId: art.id, wallet: wallet.publicKey.toBase58(), tx, editionMintId }),
      });
      const data = await r.json();
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
      setLoading(false);
    }
  }, [wallet, isOwnPost, expired, isAuthenticated, art, count]);

  return (
    <div className="collect-button-wrap">
      <button
        className={`collect-btn ${expired ? 'expired' : ''} ${ok ? 'collected' : ''}`}
        onClick={handleCollect}
        disabled={loading || isOwnPost || expired}
        title={
          expired            ? 'Janela de coleta expirada (24h)' :
          !wallet.connected  ? 'Conecte sua carteira para coletar' :
          !isAuthenticated   ? 'Assine na carteira para coletar' :
          isOwnPost          ? 'Você não pode coletar a própria obra' :
          `Coletar por ${getCollectPriceSol()} SOL + gás`
        }
      >
        {loading ? '⏳' : expired ? '⌛' : ok ? '✅' : '🪙'} {expired ? 'Expirado' : 'Coletar'} {count > 0 && `· ${count}`}
      </button>
      {!expired && remainingLabel && <span className="collect-countdown">{remainingLabel}</span>}
      {error && <div className="like-error">⚠️ {error}</div>}
      {!expired && !ok && <span className="like-price">{getCollectPriceSol()} SOL + gás do mint</span>}
    </div>
  );
}
