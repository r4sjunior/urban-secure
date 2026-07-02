/**
 * components/MarketModal.jsx
 * Mercado de revenda: quem detém uma arte URBAN (a obra original mintada
 * pelo artista, ou uma edição coletada) pode anunciá-la pra venda, e
 * qualquer outra carteira pode comprá-la.
 *
 * Ao anunciar, o NFT é transferido pra uma vault do servidor (custódia
 * temporária — ver lib/vaultSigner.js) e só volta a se mover quando alguém
 * compra (paga o vendedor, a vault libera o NFT pro comprador) ou quando o
 * próprio vendedor cancela o anúncio (a vault devolve o NFT).
 */
import { useState, useEffect, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useMyNfts } from '../lib/useMyNfts';
import { transferNft } from '../lib/nftTransfer';
import { payForListing } from '../lib/listingPayment';
import { buildDelistMessage } from '../lib/listingSignature';

export default function MarketModal({ open, onClose, isAuthenticated = false }) {
  const wallet = useWallet();
  const [tab, setTab] = useState('buy'); // 'buy' | 'sell'
  const { nfts, loading: loadingNfts, removeNft } = useMyNfts(wallet, open && tab === 'sell');

  const [listings, setListings] = useState([]);
  const [loadingListings, setLoadingListings] = useState(false);
  const [vaultAddress, setVaultAddress] = useState('');
  const [priceInputs, setPriceInputs] = useState({});
  const [busyMint, setBusyMint] = useState(null);
  const [error, setError] = useState(null);
  const [okMsg, setOkMsg] = useState(null);

  const myWallet = wallet.publicKey?.toBase58();

  const loadListings = useCallback(async () => {
    setLoadingListings(true);
    try {
      const r = await fetch('/api/listings');
      const data = await r.json();
      setListings(Array.isArray(data.listings) ? data.listings : []);
    } catch {
      // silencioso — não bloqueia a UI
    } finally {
      setLoadingListings(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    loadListings();
    fetch('/api/vault').then(r => r.json()).then(d => setVaultAddress(d.address || '')).catch(() => {});
  }, [open, loadListings]);

  function switchTab(next) {
    setTab(next);
    setError(null);
    setOkMsg(null);
  }

  const myListings = listings.filter(l => l.seller === myWallet);
  const otherListings = listings.filter(l => l.seller !== myWallet);

  const handleList = useCallback(async (nft) => {
    setError(null); setOkMsg(null);
    if (!wallet.connected || !wallet.publicKey) { setError('Conecte sua carteira.'); return; }
    if (!isAuthenticated) { setError('Assine na carteira para vender.'); return; }
    if (!vaultAddress) { setError('Marketplace indisponível no momento.'); return; }
    const price = parseFloat(priceInputs[nft.id]);
    if (!Number.isFinite(price) || price <= 0) { setError('Informe um preço válido em SOL.'); return; }

    setBusyMint(nft.id);
    try {
      await transferNft({ wallet, mint: nft.id, destination: vaultAddress });

      const r = await fetch('/api/listings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list', mint: nft.id, seller: myWallet, price, name: nft.name, imageUrl: nft.imageUrl }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Falha ao anunciar.');

      removeNft(nft.id);
      setOkMsg('Arte anunciada com sucesso!');
      loadListings();
    } catch (err) {
      console.error('[MarketModal list]', err);
      let msg = err.message || 'Erro ao anunciar.';
      if (msg.includes('insufficient') || msg.includes('0x1')) msg = 'Saldo insuficiente para a taxa.';
      else if (msg.includes('rejected') || msg.includes('User rejected')) msg = 'Transação cancelada.';
      setError(msg);
    } finally {
      setBusyMint(null);
    }
  }, [wallet, isAuthenticated, vaultAddress, priceInputs, myWallet, removeNft, loadListings]);

  const handleBuy = useCallback(async (listing) => {
    setError(null); setOkMsg(null);
    if (!wallet.connected || !wallet.publicKey) { setError('Conecte sua carteira.'); return; }
    if (!isAuthenticated) { setError('Assine na carteira para comprar.'); return; }

    setBusyMint(listing.mint);
    try {
      const tx = await payForListing(wallet, listing.seller, listing.price);

      const r = await fetch('/api/listings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'buy', mint: listing.mint, buyer: myWallet, tx }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Falha ao comprar.');

      setOkMsg('Compra confirmada! A arte foi enviada pra sua carteira.');
      loadListings();
    } catch (err) {
      console.error('[MarketModal buy]', err);
      let msg = err.message || 'Erro ao comprar.';
      if (msg.includes('insufficient') || msg.includes('0x1')) msg = 'Saldo insuficiente.';
      else if (msg.includes('rejected') || msg.includes('User rejected')) msg = 'Transação cancelada.';
      setError(msg);
    } finally {
      setBusyMint(null);
    }
  }, [wallet, isAuthenticated, myWallet, loadListings]);

  const handleCancel = useCallback(async (listing) => {
    setError(null); setOkMsg(null);
    if (!wallet.signMessage) { setError('Esta carteira não suporta assinatura de mensagem.'); return; }

    setBusyMint(listing.mint);
    try {
      const timestamp = Date.now();
      const message = buildDelistMessage({ mint: listing.mint, seller: myWallet, timestamp });
      const sigBytes = await wallet.signMessage(new TextEncoder().encode(message));
      const signature = Buffer.from(sigBytes).toString('base64');

      const r = await fetch('/api/listings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel', mint: listing.mint, seller: myWallet, timestamp, signature }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Falha ao cancelar.');

      setOkMsg('Anúncio cancelado — a arte volta pra sua carteira em instantes.');
      loadListings();
    } catch (err) {
      console.error('[MarketModal cancel]', err);
      const msg = err.message || 'Erro ao cancelar.';
      setError(msg.includes('rejected') || msg.includes('User rejected') ? 'Assinatura cancelada.' : msg);
    } finally {
      setBusyMint(null);
    }
  }, [wallet, myWallet, loadListings]);

  if (!open) return null;

  return (
    <div className="market-modal">
      <div className="market-backdrop" onClick={onClose} />
      <div className="market-panel">
        <div className="sheet-handle" onClick={onClose} />
        <h2 className="sheet-title">Mercado</h2>
        <p className="sheet-sub">Compre e venda artes URBAN já mintadas ou coletadas.</p>

        <div className="market-tabs">
          <button className={`market-tab ${tab === 'buy' ? 'active' : ''}`} onClick={() => switchTab('buy')}>🛒 Comprar</button>
          <button className={`market-tab ${tab === 'sell' ? 'active' : ''}`} onClick={() => switchTab('sell')}>🏷️ Vender</button>
        </div>

        {okMsg && <div className="transfer-ok">✅ {okMsg}</div>}
        {error && <div className="err-box">⚠️ {error}</div>}

        {tab === 'buy' && (
          <div className="market-list">
            {loadingListings ? (
              <p className="transfer-empty">Carregando anúncios…</p>
            ) : otherListings.length === 0 ? (
              <p className="transfer-empty">Nenhuma arte à venda no momento.</p>
            ) : otherListings.map(l => (
              <div className="market-item" key={l.mint}>
                <div className="transfer-item-thumb">
                  {l.imageUrl ? <img src={l.imageUrl} alt="" /> : '🎨'}
                </div>
                <div className="transfer-item-info">
                  <span className="transfer-item-name">{l.name || 'Arte URBAN'}</span>
                  <span className="market-item-price">{l.price} SOL</span>
                </div>
                <button className="market-action-btn" onClick={() => handleBuy(l)} disabled={busyMint === l.mint || !wallet.connected}>
                  {busyMint === l.mint ? '⏳' : 'Comprar'}
                </button>
              </div>
            ))}
          </div>
        )}

        {tab === 'sell' && (
          <div className="market-list">
            {myListings.length > 0 && (
              <>
                <p className="market-section-label">Seus anúncios ativos</p>
                {myListings.map(l => (
                  <div className="market-item" key={l.mint}>
                    <div className="transfer-item-thumb">
                      {l.imageUrl ? <img src={l.imageUrl} alt="" /> : '🎨'}
                    </div>
                    <div className="transfer-item-info">
                      <span className="transfer-item-name">{l.name || 'Arte URBAN'}</span>
                      <span className="market-item-price">{l.price} SOL</span>
                    </div>
                    <button className="market-action-btn cancel" onClick={() => handleCancel(l)} disabled={busyMint === l.mint}>
                      {busyMint === l.mint ? '⏳' : 'Cancelar'}
                    </button>
                  </div>
                ))}
                <p className="market-section-label">Suas artes</p>
              </>
            )}

            {!wallet.connected ? (
              <p className="transfer-empty">Conecte sua carteira primeiro.</p>
            ) : loadingNfts ? (
              <p className="transfer-empty">Carregando suas artes…</p>
            ) : nfts.length === 0 ? (
              <p className="transfer-empty">Você não tem artes URBAN pra vender.</p>
            ) : nfts.map(n => (
              <div className="market-item" key={n.id}>
                <div className="transfer-item-thumb">
                  {n.imageUrl ? <img src={n.imageUrl} alt="" /> : '🎨'}
                </div>
                <div className="transfer-item-info">
                  <span className="transfer-item-name">{n.name}</span>
                  <input
                    className="market-price-input"
                    type="number" min="0" step="0.001"
                    placeholder="Preço em SOL"
                    value={priceInputs[n.id] || ''}
                    onChange={e => setPriceInputs(p => ({ ...p, [n.id]: e.target.value }))}
                    disabled={busyMint === n.id}
                  />
                </div>
                <button className="market-action-btn" onClick={() => handleList(n)} disabled={busyMint === n.id}>
                  {busyMint === n.id ? '⏳' : 'Anunciar'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
