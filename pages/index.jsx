import { useState, useCallback, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import Link from 'next/link';
import { useWallet } from '@solana/wallet-adapter-react';
import { useArts } from '../context/ArtsContext';
import { useWalletAuth } from '../context/WalletAuthContext';
import { useMyProfile } from '../context/ProfileContext';
import { SprayCan, Flame, Menu, Search, X, Plus, Send } from 'lucide-react';
import UpdatesTicker from '../components/shell/UpdatesTicker';
import { jaViuOnboarding } from '../components/shell/Onboarding';
import { useClaim } from '../context/ClaimContext';
import Avatar from '../components/profile/Avatar';
import { resizeImage } from '../lib/resizeImage';
import { buildRegistryMessage } from '../lib/registrySignature';
import SplashScreen from '../components/shell/SplashScreen';
import AudiusPlayer from '../components/AudiusPlayer';
import ArtFeed from '../components/ArtFeed';
import Leaderboard from '../components/Leaderboard';
import { sound } from '../lib/sound';
import { uploadFile, uploadJson, mintNft } from '../lib/mint';

const MapView      = dynamic(() => import('../components/MapView'),      { ssr: false, loading: () => <div className="map-skeleton" /> });
const MintOverlay  = dynamic(() => import('../components/MintOverlay'),  { ssr: false });
const WalletHandler= dynamic(() => import('../components/WalletHandler'),{ ssr: false, loading: () => <div className="wallet-skeleton" /> });
const TransferModal= dynamic(() => import('../components/TransferModal'),{ ssr: false });
const ProfileSheet = dynamic(() => import('../components/profile/ProfileSheet'), { ssr: false });
const MenuSheet    = dynamic(() => import('../components/shell/MenuSheet'),      { ssr: false });
const Onboarding   = dynamic(() => import('../components/shell/Onboarding'),     { ssr: false });
const ClaimSheet   = dynamic(() => import('../components/claim/ClaimSheet'),     { ssr: false });
const CameraCapture= dynamic(() => import('../components/capture/CameraCapture'),{ ssr: false });

const STEPS = [
  { key: 'upload-image', label: 'Enviando imagem',   icon: '🖼️' },
  { key: 'upload-meta',  label: 'Enviando dados',    icon: '📄' },
  { key: 'minting',      label: 'Mintando NFT',      icon: '⛓️' },
];

// ── Metadados Metaplex ──
function buildMetadata({ name, description, imageUri, mime, capturedAt, lat, lng, acc, fonte, artistWallet, network }) {
  const isVideo = (mime || '').startsWith('video/');

  return {
    name, symbol: 'URBAN', description, image: imageUri,
    // Carteiras e exploradores procuram `animation_url` pra reproduzir vídeo;
    // `image` sozinho seria renderizado como imagem estática quebrada.
    ...(isVideo ? { animation_url: imageUri } : {}),
    seller_fee_basis_points: 500,
    attributes: [
      { trait_type: 'Artista',   value: name.replace('Urban Art — ', '') },
      { trait_type: 'Latitude',  value: lat.toFixed(6) },
      { trait_type: 'Longitude', value: lng.toFixed(6) },
      { trait_type: 'Precisão',  value: acc > 0 ? `±${acc}m` : 'GPS' },
      { trait_type: 'Fonte GPS', value: fonte || 'GPS' },
      { trait_type: 'Rede',      value: network || 'devnet' },
      { trait_type: 'Categoria', value: 'Arte Urbana' },
      { trait_type: 'Mídia',     value: isVideo ? 'Vídeo' : 'Foto' },
      // Instante em que o obturador foi acionado. Fica no registro público
      // como parte da prova de captura ao vivo — comparável com o timestamp
      // assinado no registro.
      { trait_type: 'Capturado em', value: new Date(capturedAt || Date.now()).toISOString() },
    ],
    properties: {
      category: isVideo ? 'video' : 'image',
      files: [{ uri: imageUri, type: mime || 'image/jpeg' }],
      creators: [{ address: artistWallet, share: 100 }],
    },
  };
}

export default function Home() {
  const wallet = useWallet();
  const { isAuthenticated } = useWalletAuth();
  const { arts, isLoading: isLoadingArts, addArt } = useArts();
  const { profile, hasProfile } = useMyProfile();
  const { status: claimStatus } = useClaim();

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
  // Mídia capturada pela câmera: { file, previewUrl, capturedAt, kind }.
  // Não existe caminho pra popular isto a partir de um arquivo escolhido —
  // ver lib/capture/useCamera.js.
  const [media, setMedia] = useState(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [gps, setGps] = useState(null);
  const [busca, setBusca] = useState('');
  const [booting, setBooting] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [feedOpen, setFeedOpen] = useState(false);
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [popupOpen, setPopupOpen] = useState(false);
  const [muted, setMuted] = useState(() => (typeof window !== 'undefined' ? sound.isMuted() : true));

  const [isMinting, setIsMinting] = useState(false);
  const [mintStep, setMintStep] = useState(null);
  const [mintError, setMintError] = useState(null);
  const [mintResult, setMintResult] = useState(null);

  const handleLocationUpdate = useCallback(d => setGps(d), []);

  const artsFiltradas = busca.trim()
    ? arts.filter(a => {
        const t = busca.toLowerCase();
        return (a.artistName||'').toLowerCase().includes(t)
            || (a.name||'').toLowerCase().includes(t)
            || (a.description||'').toLowerCase().includes(t);
      })
    : arts;

  const handleCapture = useCallback((captured) => {
    // Libera o preview anterior — cada captura cria um object URL, e refazer
    // a foto várias vezes vazaria um blob por tentativa.
    setMedia(prev => {
      if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
      return captured;
    });
    setCameraOpen(false);
    setMintError(null);
  }, []);

  function resetForm() {
    setNome(''); setDescricao('');
    setMedia(prev => { if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl); return null; });
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
    if (!media?.file) return setMintError('Fotografe ou grave a obra pela câmera.');

    const network = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet';
    const artistWallet = wallet.publicKey.toBase58();
    const nftName = `Urban Art — ${nome}`;

    setIsMinting(true); setMintError(null); setMintResult(null);
    sound.play('transaction');

    try {
      setMintStep('upload-image');
      // Vídeo já sai do MediaRecorder com bitrate limitado; passar por
      // resizeImage (que é canvas de imagem) o corromperia.
      const toUpload = media.kind === 'video'
        ? media.file
        : await resizeImage(media.file, 1200, 0.85);
      const { url: imageUri, mime } = await uploadFile(toUpload);

      setMintStep('upload-meta');
      const metadata = buildMetadata({
        name: nftName, description: descricao, imageUri, mime,
        capturedAt: media.capturedAt,
        lat: gps.lat, lng: gps.lng, acc: gps.acc, fonte: gps.fonte,
        artistWallet, network,
      });
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
        {/* Valor inicial; o ThemeContext o reescreve conforme o tema ativo. */}
        <meta name="theme-color" content="#0A0B0D" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <link rel="manifest" href="/manifest.json" />
      </Head>

      {booting && (
        <SplashScreen
          onDone={() => {
            setBooting(false);
            // Só depois da abertura sair — os dois ao mesmo tempo seriam
            // duas telas cheias empilhadas.
            if (!jaViuOnboarding()) setTourOpen(true);
          }}
        />
      )}

      <div className="app">
        {/* Fundo animado */}
        <div className="bg-mesh" />
        <div className="bg-grid" />

        {/* Topbar — só o que se usa em toda sessão. O resto vive no menu:
            nove botões de 40px não cabem numa tela de celular sem virar
            aquela fileira apertada de quadradinhos. */}
        <header className="topbar">
          <div className="brand">
            <span className="brand-mark"><SprayCan className="lucide" /></span>
            <span className="brand-name">URBAN<span className="brand-accent">SECURE</span></span>
          </div>

          <div className="topbar-right">
            <div className={`gps-chip ${gpsClass}`}>
              <span className="gps-led" />{gpsLabel}
            </div>

            {wallet.connected && (
              <button
                className={`streak-chip${claimStatus.canClaim ? ' ready' : ''}${claimStatus.streakAtRisk ? ' risk' : ''}`}
                onClick={() => { sound.play('click'); setClaimOpen(true); }}
                title={claimStatus.canClaim ? 'Resgate disponível' : 'Claim diário'}
                aria-label="Claim diário"
              >
                <Flame className="lucide" />
                <span className="streak-chip-n">{claimStatus.currentStreak}</span>
              </button>
            )}

            {wallet.connected && (
              <button
                className="profile-toggle"
                onClick={() => { sound.play('click'); setProfileOpen(true); }}
                title="Meu perfil"
                aria-label="Meu perfil"
              >
                <Avatar profile={profile} wallet={wallet.publicKey?.toBase58()} size={30} />
                {/* Ponto de atenção em quem ainda não preencheu o perfil — a
                    figurinha credita o artista pelo nome, então perfil vazio
                    é um custo real pro usuário, não só um campo em branco. */}
                {!hasProfile && <span className="profile-toggle-dot" />}
              </button>
            )}

            <button
              className="icon-btn"
              onClick={() => { sound.play('click'); setMenuOpen(true); }}
              title="Menu"
              aria-label="Abrir menu"
            >
              <Menu className="lucide" />
            </button>
          </div>
        </header>

        {/* Mapa em tela cheia */}
        <main className={`map-stage${popupOpen ? ' popup-open' : ''}`}>
          <MapView onReady={handleMapReady} onLocationUpdate={handleLocationUpdate} onPopupToggle={setPopupOpen} arts={artsFiltradas} isLoading={isLoadingArts} />

          {/* Busca — pílula, com o ícone como elemento próprio em vez de
              emoji dentro do placeholder (que não alinhava e não escalava) */}
          <div className="search-float">
            <span className="search-ico"><Search className="lucide" /></span>
            <input
              className="search-in"
              placeholder="Buscar artista ou obra"
              value={busca}
              onChange={e => setBusca(e.target.value)}
            />
            {busca && (
              <button className="search-x" onClick={() => setBusca('')} aria-label="Limpar busca">
                <X className="lucide" />
              </button>
            )}
          </div>
        </main>

        {/* Novidades do app */}
        {/* A trilha só toca com o componente montado; o controle de som
            passou para o menu, então ele fica fora de vista, não removido. */}
        <div className="audio-host"><AudiusPlayer muted={muted} /></div>

        <UpdatesTicker />

        {/* Dock inferior */}
        <nav className="dock">
          <div className="dock-wallet"><WalletHandler /></div>

          {wallet.connected && isAuthenticated && (
            <button
              className="dock-send"
              onClick={() => { sound.play('click'); setTransferOpen(true); }}
              title="Enviar arte"
              aria-label="Enviar arte"
            >
              <Send className="lucide" />
            </button>
          )}

          <button className="dock-cta" onClick={() => { sound.play('click'); setSheetOpen(true); }}>
            <Plus className="lucide" />
            Registrar
          </button>
        </nav>

        {/* Câmera ao vivo — único caminho de entrada de mídia do registro */}
        <CameraCapture
          open={cameraOpen}
          onCapture={handleCapture}
          onClose={() => setCameraOpen(false)}
        />

        {/* Navegação secundária */}
        <MenuSheet
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          onFeed={() => setFeedOpen(true)}
          onLeaderboard={() => setLeaderboardOpen(true)}
          onTutorial={() => setTourOpen(true)}
          muted={muted}
          onToggleSound={handleToggleSound}
        />

        {/* Tutorial da proposta do app */}
        <Onboarding open={tourOpen} onClose={() => setTourOpen(false)} />

        {/* Claim diário — streak, resgate e regras */}
        <ClaimSheet
          open={claimOpen}
          onClose={() => setClaimOpen(false)}
          onEditarPerfil={() => setProfileOpen(true)}
        />

        {/* Perfil próprio — stats, foto, bio e redes sociais */}
        <ProfileSheet open={profileOpen} onClose={() => setProfileOpen(false)} />

        {/* Modal de transferência */}
        <TransferModal open={transferOpen} onClose={() => setTransferOpen(false)} />

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

            {/* Só há um caminho pra mídia: a câmera ao vivo. Não existe input
                de arquivo aqui de propósito — é o que garante que a obra foi
                fotografada no local, e não baixada da internet. */}
            <div className="upload-zone">
              {media?.kind === 'video' ? (
                <video className="upload-preview" src={media.previewUrl} muted loop autoPlay playsInline />
              ) : media ? (
                <img className="upload-preview" src={media.previewUrl} alt="Prévia da captura" />
              ) : (
                <>
                  <span className="upload-ico">📷</span>
                  <span>Registre a obra pela câmera</span>
                </>
              )}
            </div>

            <div className="upload-btns">
              <button className="upload-btn" onClick={() => { sound.play('click'); setCameraOpen(true); }} disabled={isMinting}>
                {media ? 'Refazer captura' : '📸 Abrir câmera'}
              </button>
            </div>

            {!media && (
              <p className="capture-note">
                Só aceita foto ou vídeo feito agora, no local — é o que garante que a arte é real.
              </p>
            )}

            <input className="fld" placeholder="Nome do artista" value={nome} onChange={e=>setNome(e.target.value)} maxLength={50} disabled={isMinting} />
            <textarea className="fld" placeholder="Descrição da obra" value={descricao} onChange={e=>setDescricao(e.target.value)} rows={2} maxLength={200} disabled={isMinting} />

            {wallet.connected && !isAuthenticated && !isMinting && !mintError && (
              <div className="auth-hint">Assine na carteira para registrar artes.</div>
            )}
            {mintError && !isMinting && <div className="err-box">{mintError}</div>}

            <button className="mint-cta" onClick={handleMint} disabled={isMinting}>
              {isMinting ? 'Processando…' : 'Mintar na Solana'}
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
