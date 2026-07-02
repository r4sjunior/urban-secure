import { useState, useCallback, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import { useWallet } from '@solana/wallet-adapter-react';
import { useArts } from '../context/ArtsContext';
import { useWalletAuth } from '../context/WalletAuthContext';
import { resizeImage } from '../lib/resizeImage';
import { buildRegistryMessage } from '../lib/registrySignature';
import ArtCarousel from '../components/ArtCarousel';
import BootScreen from '../components/BootScreen';
import SoundToggle from '../components/SoundToggle';
import AudiusPlayer from '../components/AudiusPlayer';
import ArtFeed from '../components/ArtFeed';
import Leaderboard from '../components/Leaderboard';
import { sound } from '../lib/sound';
import { uploadFile, uploadJson, mintNft } from '../lib/mint';

const MapView      = dynamic(() => import('../components/MapView'),      { ssr: false, loading: () => <div className="map-skeleton" /> });
const MintOverlay  = dynamic(() => import('../components/MintOverlay'),  { ssr: false });
const WalletHandler= dynamic(() => import('../components/WalletHandler'),{ ssr: false, loading: () => <div className="wallet-skeleton" /> });
const TransferModal= dynamic(() => import('../components/TransferModal'),{ ssr: false });
const MarketModal  = dynamic(() => import('../components/MarketModal'),  { ssr: false });

const STEPS = [
  { key: 'upload-image', label: 'Enviando imagem',   icon: '🖼️' },
  { key: 'upload-meta',  label: 'Enviando dados',    icon: '📄' },
  { key: 'minting',      label: 'Mintando NFT',      icon: '⛓️' },
];

// ── Metadados Metaplex ──
function buildMetadata({ name, description, imageUri, lat, lng, acc, fonte, artistWallet, network }) {
  return {
    name, symbol: 'URBAN', description, image: imageUri,
    seller_fee_basis_points: 500,
    attributes: [
      { trait_type: 'Artista',   value: name.replace('Urban Art — ', '') },
      { trait_type: 'Latitude',  value: lat.toFixed(6) },
      { trait_type: 'Longitude', value: lng.toFixed(6) },
      { trait_type: 'Precisão',  value: acc > 0 ? `±${acc}m` : 'GPS' },
      { trait_type: 'Fonte GPS', value: fonte || 'GPS' },
      { trait_type: 'Rede',      value: network || 'devnet' },
      { trait_type: 'Categoria', value: 'Arte Urbana' },
    ],
    properties: {
      category: 'image',
      files: [{ uri: imageUri, type: 'image/jpeg' }],
      creators: [{ address: artistWallet, share: 100 }],
    },
  };
}

export default function Home() {
  const wallet = useWallet();
  const { isAuthenticated } = useWalletAuth();
  const { arts, isLoading: isLoadingArts, addArt } = useArts();

  const mapRef = useRef(null);
  // Recebe a API do mapa via callback (funciona mesmo com next/dynamic)
  const handleMapReady = useCallback((api) => { mapRef.current = api; }, []);
  const handleSelectArt = useCallback((art) => {
    sound.play('click');
    if (mapRef.current?.focusArt) mapRef.current.focusArt(art);
  }, []);
  const handleFeedLocate = useCallback((art) => {
    setFeedOpen(false);
    handleSelectArt(art);
  }, [handleSelectArt]);
  const handleLeaderboardLocate = useCallback((art) => {
    setLeaderboardOpen(false);
    handleSelectArt(art);
  }, [handleSelectArt]);
  const handleToggleSound = useCallback(() => {
    const nowMuted = sound.toggleMute();
    setMuted(nowMuted);
    if (!nowMuted) sound.play('click');
  }, []);

  const [nome, setNome] = useState('');
  const [descricao, setDescricao] = useState('');
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState('');
  const [gps, setGps] = useState(null);
  const [busca, setBusca] = useState('');
  const [booting, setBooting] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [marketOpen, setMarketOpen] = useState(false);
  const [feedOpen, setFeedOpen] = useState(false);
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [muted, setMuted] = useState(() => (typeof window !== 'undefined' ? sound.isMuted() : true));

  const [isMinting, setIsMinting] = useState(false);
  const [mintStep, setMintStep] = useState(null);
  const [mintError, setMintError] = useState(null);
  const [mintResult, setMintResult] = useState(null);

  const handleLocationUpdate = useCallback(d => setGps(d), []);

  // Mede a altura real do carrossel (0 quando não há artes) e expõe via CSS var
  // pra elementos flutuantes (.search-float, .map-counter) nunca sobreporem
  // nem deixarem espaço morto abaixo dele. Usa ref callback porque o carrossel
  // desmonta (retorna null) quando não há artes — o próprio unmount já zera a altura.
  const carouselRoRef = useRef(null);
  const setCarouselRef = useCallback((node) => {
    if (carouselRoRef.current) { carouselRoRef.current.disconnect(); carouselRoRef.current = null; }
    if (typeof document === 'undefined') return;
    if (node && typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => {
        document.documentElement.style.setProperty('--carousel-h', `${node.offsetHeight}px`);
      });
      ro.observe(node);
      carouselRoRef.current = ro;
    } else {
      document.documentElement.style.setProperty('--carousel-h', '0px');
    }
  }, []);

  const artsFiltradas = busca.trim()
    ? arts.filter(a => {
        const t = busca.toLowerCase();
        return (a.artistName||'').toLowerCase().includes(t)
            || (a.name||'').toLowerCase().includes(t)
            || (a.description||'').toLowerCase().includes(t);
      })
    : arts;

  const handleImageChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    const r = new FileReader();
    r.onload = () => setImagePreview(r.result);
    r.readAsDataURL(file);
  };

  function resetForm() {
    setNome(''); setDescricao(''); setImageFile(null); setImagePreview('');
    setMintStep(null); setMintError(null); setMintResult(null);
  }
  function handleOverlayDismiss() {
    if (mintError) { setMintError(null); setMintStep(null); setIsMinting(false); }
    else { resetForm(); setSheetOpen(false); }
  }

  const handleMint = async () => {
    if (!wallet.connected || !wallet.publicKey) return setMintError('Conecte sua carteira primeiro.');
    if (!isAuthenticated) return setMintError('Assine na carteira para registrar uma arte.');
    const gpsOk = gps && !gps.error && gps.lat && gps.lng;
    if (!gpsOk) return setMintError('Aguardando GPS. Vá para área aberta.');
    if (!nome.trim() || !descricao.trim()) return setMintError('Preencha nome e descrição.');
    if (!imageFile) return setMintError('Selecione ou fotografe a obra.');

    const network = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet';
    const artistWallet = wallet.publicKey.toBase58();
    const nftName = `Urban Art — ${nome}`;

    setIsMinting(true); setMintError(null); setMintResult(null);
    sound.play('transaction');

    try {
      setMintStep('upload-image');
      const resized = await resizeImage(imageFile, 800, 0.85);
      const imageUri = await uploadFile(resized);

      setMintStep('upload-meta');
      const metadata = buildMetadata({ name: nftName, description: descricao, imageUri, lat: gps.lat, lng: gps.lng, acc: gps.acc, fonte: gps.fonte, artistWallet, network });
      const metadataUri = await uploadJson(metadata);

      setMintStep('minting');
      const mintAddress = await mintNft({ wallet, metadataUri, name: nftName });

      setMintResult({
        address: mintAddress,
        explorerUrl: `https://explorer.solana.com/address/${mintAddress}?cluster=${network}`,
        solscanUrl: `https://solscan.io/token/${mintAddress}${network==='devnet'?'?cluster=devnet':''}`,
      });
      setMintStep('success');
      sound.play('success');
      const novaArte = { id: mintAddress, name: nftName, artistName: nome, description: descricao, lat: gps.lat, lng: gps.lng, imageUrl: imageUri, artistWallet, timestamp: Date.now() };
      addArt(novaArte);

      // Registra no índice do Pinata para que TODOS vejam (contorna devnet).
      // O servidor exige a assinatura da wallet provando autoria deste registro.
      try {
        let signature = '';
        if (wallet.signMessage) {
          const message = buildRegistryMessage({ id: novaArte.id, artistWallet: novaArte.artistWallet, timestamp: novaArte.timestamp });
          const sigBytes = await wallet.signMessage(new TextEncoder().encode(message));
          signature = Buffer.from(sigBytes).toString('base64');
        }
        const rReg = await fetch('/api/registry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...novaArte, signature }),
        });
        if (!rReg.ok) {
          const j = await rReg.json().catch(() => ({}));
          console.error('[registry]', j.error || rReg.status);
        }
      } catch (e) { console.error('[registry]', e); }
    } catch (err) {
      console.error('[handleMint]', err);
      let msg = err.message || 'Erro desconhecido.';
      if (msg.includes('insufficient') || msg.includes('0x1')) msg = 'Saldo insuficiente. Pegue SOL em faucet.solana.com';
      else if (msg.includes('rejected')) msg = 'Transação cancelada na carteira.';
      else if (msg.includes('expired') || msg.includes('block height') || msg.includes('blockhash')) msg = 'A rede demorou a confirmar. Verifique sua carteira ou tente de novo.';
      else msg = 'Não foi possível mintar. Tente novamente.';
      setMintError(msg); setMintStep(null);
      sound.play('error');
    } finally { setIsMinting(false); }
  };

  const gpsOk = gps && !gps.error && gps.lat && gps.lng;
  const gpsClass = !gps ? 'wait' : gps.error ? 'err' : 'ok';
  const gpsLabel = !gps ? 'Buscando GPS…' : gps.error ? gps.error : gps.acc > 0 ? `GPS ±${gps.acc}m` : 'GPS';

  return (
    <>
      <Head>
        <title>Urban Secure · Arte na Blockchain</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        <meta name="theme-color" content="#0a0a0f" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <link rel="manifest" href="/manifest.json" />
        <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Outfit:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      </Head>

      {booting && <BootScreen onDone={() => setBooting(false)} />}

      <div className="app">
        {/* Fundo animado */}
        <div className="bg-mesh" />
        <div className="bg-grid" />

        {/* Topbar */}
        <header className="topbar">
          <div className="brand">
            <span className="brand-mark">◢◣</span>
            <span className="brand-name">URBAN<span className="brand-accent">SECURE</span></span>
          </div>
          <div className="topbar-right">
            <div className={`gps-chip ${gpsClass}`}>
              <span className="gps-led" />{gpsLabel}
            </div>
            <button className="feed-toggle" onClick={() => { sound.play('click'); setFeedOpen(true); }} title="Feed" aria-label="Feed">
              🗞️
            </button>
            <button className="feed-toggle" onClick={() => { sound.play('click'); setLeaderboardOpen(true); }} title="Leaderboard" aria-label="Leaderboard">
              🏆
            </button>
            <button className="feed-toggle" onClick={() => { sound.play('click'); setMarketOpen(true); }} title="Mercado" aria-label="Mercado">
              🛒
            </button>
            <AudiusPlayer muted={muted} />
            <SoundToggle muted={muted} onToggle={handleToggleSound} />
          </div>
        </header>

        {/* Mapa em tela cheia */}
        <main className="map-stage">
          <MapView onReady={handleMapReady} onLocationUpdate={handleLocationUpdate} arts={artsFiltradas} isLoading={isLoadingArts} />

          {/* Carrossel de artes registradas (topo) — altura medida via ResizeObserver acima */}
          <ArtCarousel ref={setCarouselRef} arts={artsFiltradas} onSelect={handleSelectArt} />

          {/* Busca flutuante */}
          <div className="search-float">
            <input className="search-in" placeholder="🔍 Buscar artista ou obra…" value={busca} onChange={e=>setBusca(e.target.value)} />
            {busca && <button className="search-x" onClick={()=>setBusca('')}>✕</button>}
          </div>
        </main>

        {/* Dock inferior */}
        <nav className="dock">
          <div className="dock-wallet"><WalletHandler /></div>
          {wallet.connected && isAuthenticated && (
            <button className="dock-send" onClick={() => { sound.play('click'); setTransferOpen(true); }} title="Enviar arte">📤</button>
          )}
          <button className="dock-cta" onClick={() => { sound.play('click'); setSheetOpen(true); }}>
            <span className="dock-cta-icon">＋</span>
            Registrar Arte
          </button>
        </nav>

        {/* Modal de transferência */}
        <TransferModal open={transferOpen} onClose={() => setTransferOpen(false)} />

        {/* Mercado de revenda — comprar/vender artes já mintadas ou coletadas */}
        <MarketModal open={marketOpen} onClose={() => setMarketOpen(false)} isAuthenticated={isAuthenticated} />

        {/* Feed estilo Instagram com as últimas artes registradas */}
        <ArtFeed open={feedOpen} onClose={() => setFeedOpen(false)} arts={arts} onLocate={handleFeedLocate} isAuthenticated={isAuthenticated} />

        {/* Leaderboard das 100 artes mais curtidas */}
        <Leaderboard open={leaderboardOpen} onClose={() => setLeaderboardOpen(false)} arts={arts} onLocate={handleLeaderboardLocate} />

        {/* Bottom sheet do formulário */}
        <div className={`sheet ${sheetOpen ? 'open' : ''}`}>
          <div className="sheet-backdrop" onClick={() => !isMinting && setSheetOpen(false)} />
          <div className="sheet-panel">
            <div className="sheet-handle" onClick={() => !isMinting && setSheetOpen(false)} />
            <h2 className="sheet-title">Registrar Arte Urbana</h2>
            <p className="sheet-sub">Sua obra vira um NFT na Solana, na sua carteira.</p>

            <div className="upload-zone" style={{ backgroundImage: imagePreview ? `url(${imagePreview})` : 'none' }}>
              {!imagePreview && <span className="upload-ico">📷</span>}
              {!imagePreview && <span>Escolha uma opção abaixo</span>}
            </div>
            <div className="upload-btns">
              <label className="upload-btn">
                📸 Tirar foto
                <input type="file" accept="image/*" capture="environment" onChange={handleImageChange} disabled={isMinting} hidden />
              </label>
              <label className="upload-btn">
                🖼️ Galeria
                <input type="file" accept="image/*" onChange={handleImageChange} disabled={isMinting} hidden />
              </label>
            </div>

            <input className="fld" placeholder="Nome do artista" value={nome} onChange={e=>setNome(e.target.value)} maxLength={50} disabled={isMinting} />
            <textarea className="fld" placeholder="Descrição da obra" value={descricao} onChange={e=>setDescricao(e.target.value)} rows={2} maxLength={200} disabled={isMinting} />

            {wallet.connected && !isAuthenticated && !isMinting && !mintError && (
              <div className="auth-hint">✍️ Assine na carteira para registrar artes.</div>
            )}
            {mintError && !isMinting && <div className="err-box">⚠️ {mintError}</div>}

            <button className="mint-cta" onClick={handleMint} disabled={isMinting}>
              {isMinting ? '⏳ Processando…' : '🎨 Mintar na Solana'}
            </button>

            <p className="fee-note">Você paga apenas a taxa de gás da rede (~0.01 SOL)</p>
          </div>
        </div>

        {/* Overlay do mint — aparece durante processo, sucesso, ou erro fora do sheet */}
        <MintOverlay
          visible={isMinting || mintStep === 'success' || !!mintError}
          step={mintStep}
          error={mintError}
          result={mintResult}
          onDismiss={handleOverlayDismiss}
        />
      </div>
    </>
  );
}
