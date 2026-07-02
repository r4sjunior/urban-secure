/**
 * components/CollectButton.jsx
 * Botão de "coletar" — paga o artista original (0,0012 SOL por padrão) e
 * minta uma EDIÇÃO da obra na carteira de quem coleta. Só funciona nas
 * primeiras 24h depois do registro da obra.
 *
 * Depois das 24h, a coleta padrão fecha e vira um fluxo de proposta:
 *  - Qualquer wallet pode PROPOR um lance (5x/10x/20x/50x) — de graça, só
 *    assinatura, sem pagar nada ainda.
 *  - O DONO da obra vê as propostas recebidas e Aceita ou Recusa cada uma.
 *  - Só depois de aceita é que o comprador paga e minta a edição, no valor
 *    do tier proposto.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { payForCollect, getCollectPriceSol, COLLECT_TIERS } from '../lib/collectPayment';
import { uploadJson, mintNft } from '../lib/mint';
import { safeJson } from '../lib/safeJson';
import { buildProposeOfferMessage, buildRespondOfferMessage } from '../lib/offerSignature';

const COLLECT_WINDOW_MS = 24 * 60 * 60 * 1000;

function formatRemaining(ms) {
  if (ms <= 0) return null;
  const totalMin = Math.ceil(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h < 1) return `${m}min restantes`;
  return `${h}h ${m}min restantes`;
}

function shortWallet(w) {
  if (!w) return '?';
  return `${w.slice(0, 4)}…${w.slice(-4)}`;
}

function offerStatusLabel(status) {
  if (status === 'rejected') return 'recusada';
  if (status === 'expired') return 'expirada';
  if (status === 'completed') return 'concluída';
  return status;
}

export default function CollectButton({ art, initialCount = 0, wallet: injectedWallet, isAuthenticated = false }) {
  const contextWallet = useWallet();
  const wallet = injectedWallet || contextWallet;
  const myWallet = wallet.publicKey?.toBase58();

  const [count, setCount] = useState(initialCount);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const isOwnPost = myWallet && art.artistWallet === myWallet;
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

  // ── Propostas (só carregadas depois que a coleta padrão expira) ──
  const [offers, setOffers] = useState([]);
  const [offersLoading, setOffersLoading] = useState(false);
  const [busyTier, setBusyTier] = useState(null);
  const [busyOfferId, setBusyOfferId] = useState(null);

  const loadOffers = useCallback(async () => {
    if (!expired) return;
    setOffersLoading(true);
    try {
      const r = await fetch(`/api/offers?postId=${encodeURIComponent(art.id)}`);
      const data = await safeJson(r);
      setOffers(Array.isArray(data.offers) ? data.offers : []);
    } catch {
      // silencioso — não bloqueia a UI
    } finally {
      setOffersLoading(false);
    }
  }, [expired, art.id]);

  useEffect(() => { loadOffers(); }, [loadOffers]);

  const myOffers = useMemo(() => offers.filter(o => o.buyerWallet === myWallet), [offers, myWallet]);
  const myPendingOffer  = myOffers.find(o => o.status === 'pending');
  const myAcceptedOffer = myOffers.find(o => o.status === 'accepted');
  const myLastResolved  = [...myOffers].reverse().find(o => ['rejected', 'expired', 'completed'].includes(o.status));
  const incomingPending = useMemo(() => isOwnPost ? offers.filter(o => o.status === 'pending') : [], [offers, isOwnPost]);

  // ── Coleta padrão (tier 1, dentro das 24h) ──
  const handleCollectStandard = useCallback(async () => {
    setError(null); setOk(false);
    if (!wallet.connected || !wallet.publicKey) { setError('Conecte sua carteira para coletar.'); return; }
    if (!isAuthenticated) { setError('Assine na carteira para coletar.'); return; }
    if (isOwnPost) { setError('Você não pode coletar a própria obra.'); return; }
    if (expired) { setError('Coleta padrão expirada — proponha um lance.'); return; }

    setLoading(true);
    try {
      const tx = await payForCollect(wallet, art.artistWallet, 1);
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
        body: JSON.stringify({ postId: art.id, wallet: myWallet, tx, editionMintId, tier: 1 }),
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
      setLoading(false);
    }
  }, [wallet, isOwnPost, expired, isAuthenticated, art, count, myWallet]);

  // ── Propor lance (grátis, só assinatura) ──
  const handlePropose = useCallback(async (tier) => {
    setError(null);
    if (!wallet.connected || !wallet.publicKey) { setError('Conecte sua carteira para propor.'); return; }
    if (!isAuthenticated) { setError('Assine na carteira para propor.'); return; }
    if (!wallet.signMessage) { setError('Esta carteira não suporta assinatura de mensagem.'); return; }

    setBusyTier(tier);
    try {
      const timestamp = Date.now();
      const message = buildProposeOfferMessage({ postId: art.id, buyerWallet: myWallet, tier, timestamp });
      const sigBytes = await wallet.signMessage(new TextEncoder().encode(message));
      const signature = Buffer.from(sigBytes).toString('base64');

      const r = await fetch('/api/offers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'propose', postId: art.id, buyerWallet: myWallet, tier, timestamp, signature }),
      });
      const data = await safeJson(r);
      if (!r.ok) throw new Error(data.error || 'Falha ao propor lance.');
      await loadOffers();
    } catch (err) {
      console.error('[CollectButton propose]', err);
      const msg = err.message || 'Erro ao propor lance.';
      setError(msg.includes('rejected') || msg.includes('User rejected') ? 'Assinatura cancelada.' : msg);
    } finally {
      setBusyTier(null);
    }
  }, [wallet, isAuthenticated, art.id, myWallet, loadOffers]);

  // ── Dono aceita/recusa uma proposta recebida ──
  const handleRespond = useCallback(async (offer, decision) => {
    setError(null);
    if (!wallet.signMessage) { setError('Esta carteira não suporta assinatura de mensagem.'); return; }

    setBusyOfferId(offer.id);
    try {
      const timestamp = Date.now();
      const message = buildRespondOfferMessage({ postId: art.id, offerId: offer.id, artistWallet: myWallet, decision, timestamp });
      const sigBytes = await wallet.signMessage(new TextEncoder().encode(message));
      const signature = Buffer.from(sigBytes).toString('base64');

      const r = await fetch('/api/offers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'respond', postId: art.id, offerId: offer.id, artistWallet: myWallet, decision, timestamp, signature }),
      });
      const data = await safeJson(r);
      if (!r.ok) throw new Error(data.error || 'Falha ao responder proposta.');
      await loadOffers();
    } catch (err) {
      console.error('[CollectButton respond]', err);
      const msg = err.message || 'Erro ao responder proposta.';
      setError(msg.includes('rejected') || msg.includes('User rejected') ? 'Assinatura cancelada.' : msg);
    } finally {
      setBusyOfferId(null);
    }
  }, [wallet, art.id, myWallet, loadOffers]);

  // ── Comprador paga e minta depois que o dono aceitou ──
  const handlePayAccepted = useCallback(async () => {
    if (!myAcceptedOffer) return;
    const tier = myAcceptedOffer.tier;
    setError(null); setOk(false);

    if (!wallet.connected || !wallet.publicKey) { setError('Conecte sua carteira.'); return; }
    if (!isAuthenticated) { setError('Assine na carteira.'); return; }

    setLoading(true);
    try {
      const tx = await payForCollect(wallet, art.artistWallet, tier);
      const metadata = {
        name: `${art.name} — Edição Coletada (Lance ${tier}x)`,
        symbol: 'URBAN',
        description: art.description,
        image: art.imageUrl,
        seller_fee_basis_points: 500,
        attributes: [
          { trait_type: 'Latitude',   value: String(art.lat) },
          { trait_type: 'Longitude',  value: String(art.lng) },
          { trait_type: 'Categoria',  value: 'Arte Urbana — Edição' },
          { trait_type: 'Edição de',  value: art.id },
          { trait_type: 'Lance',      value: `${tier}x` },
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
        body: JSON.stringify({ postId: art.id, wallet: myWallet, tx, editionMintId, tier }),
      });
      const data = await safeJson(r);
      if (!r.ok) throw new Error(data.error || 'Falha ao registrar coleta.');

      setOk(true);
      setCount(data.count ?? (count + 1));
      await loadOffers();
    } catch (err) {
      console.error('[CollectButton pay]', err);
      let msg = err.message || 'Erro ao coletar.';
      if (msg.includes('insufficient') || msg.includes('0x1')) msg = 'Saldo insuficiente para coletar.';
      else if (msg.includes('rejected') || msg.includes('User rejected')) msg = 'Transação cancelada na carteira.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [wallet, isAuthenticated, art, count, myWallet, myAcceptedOffer, loadOffers]);

  const disabledBase = loading || isOwnPost;

  return (
    <div className="collect-button-wrap">
      {!expired ? (
        <button
          className={`collect-btn ${ok ? 'collected' : ''}`}
          onClick={handleCollectStandard}
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
      ) : isOwnPost ? (
        <div className="collect-offers-owner">
          {offersLoading ? (
            <span className="collect-tiers-label">Carregando propostas…</span>
          ) : incomingPending.length === 0 ? (
            <span className="collect-tiers-label">⌛ Coleta padrão encerrada — nenhuma proposta ainda</span>
          ) : (
            <>
              <span className="collect-tiers-label">⌛ Propostas recebidas:</span>
              {incomingPending.map(o => (
                <div className="collect-offer-row" key={o.id}>
                  <span className="collect-offer-info">{shortWallet(o.buyerWallet)} · {o.tier}× ({getCollectPriceSol(o.tier)} SOL)</span>
                  <button className="collect-offer-accept" onClick={() => handleRespond(o, 'accept')} disabled={busyOfferId === o.id}>
                    {busyOfferId === o.id ? '⏳' : '✅ Aceitar'}
                  </button>
                  <button className="collect-offer-reject" onClick={() => handleRespond(o, 'reject')} disabled={busyOfferId === o.id}>
                    {busyOfferId === o.id ? '⏳' : '✕ Recusar'}
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      ) : myAcceptedOffer ? (
        <div className="collect-tiers">
          <span className="collect-tiers-label">✅ Proposta de {myAcceptedOffer.tier}× aceita pelo dono!</span>
          <button className="collect-tier-btn" onClick={handlePayAccepted} disabled={loading}>
            {loading ? '⏳ Processando…' : `Pagar e coletar · ${getCollectPriceSol(myAcceptedOffer.tier)} SOL`}
          </button>
        </div>
      ) : myPendingOffer ? (
        <span className="collect-tiers-label">⏳ Proposta de {myPendingOffer.tier}× enviada — aguardando o dono responder (até 24h)</span>
      ) : (
        <div className="collect-tiers">
          <span className="collect-tiers-label">⌛ Coleta padrão encerrada — propor lance:</span>
          <div className="collect-tiers-row">
            {COLLECT_TIERS.map(t => (
              <button
                key={t}
                className="collect-tier-btn"
                onClick={() => handlePropose(t)}
                disabled={busyTier !== null}
                title={
                  !wallet.connected  ? 'Conecte sua carteira para propor' :
                  !isAuthenticated   ? 'Assine na carteira para propor' :
                  `Propor ${getCollectPriceSol(t)} SOL — precisa da aprovação do dono da obra`
                }
              >
                {busyTier === t ? '⏳' : `${t}×`}
              </button>
            ))}
          </div>
          {myLastResolved && (
            <span className="collect-count-label">Última proposta: {myLastResolved.tier}× — {offerStatusLabel(myLastResolved.status)}</span>
          )}
        </div>
      )}
      {count > 0 && <span className="collect-count-label">🪙 {count} coletados</span>}
      {error && <div className="like-error">⚠️ {error}</div>}
      {!expired && !ok && <span className="like-price">{getCollectPriceSol()} SOL + gás do mint</span>}
      {!expired && remainingLabel && <span className="collect-countdown">{remainingLabel}</span>}
    </div>
  );
}
