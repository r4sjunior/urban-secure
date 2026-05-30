import { useState, useCallback, useEffect } from 'react';
import dynamic                               from 'next/dynamic';
import Head                                  from 'next/head';
import { useWallet, useConnection }          from '@solana/wallet-adapter-react';

// ── Dynamic imports — ssr:false em tudo que toca window/wallet ──
const WalletMultiButton = dynamic(
  () => import('@solana/wallet-adapter-react-ui').then(m => m.WalletMultiButton),
  { ssr: false, loading: () => <div className="wallet-btn-skeleton" /> }
);

const MapView = dynamic(
  () => import('../components/MapView'),
  { ssr: false, loading: () => <div className="map-skeleton" /> }
);

const MintOverlay = dynamic(
  () => import('../components/MintOverlay'),
  { ssr: false }
);

const WalletHandler = dynamic(
  () => import('../components/WalletHandler'),
  { ssr: false, loading: () => <div className="wallet-btn-skeleton" /> }
);

import { useArts } from '../context/ArtsContext';
import { resizeImage }       from '../lib/resizeImage';

// ─── Etapas do mint ───────────────────────────────────────────
const STEPS = [
  { key: 'upload-image', label: 'Enviando imagem ao IPFS',    icon: '🖼️' },
  { key: 'upload-meta',  label: 'Enviando metadados ao IPFS', icon: '📄' },
  { key: 'minting',      label: 'Mintando NFT na Solana',     icon: '⛓️' },
];

// ─── Upload via API Route (JWT fica no servidor, nunca exposto) ──
async function uploadFile(file) {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/upload', { method: 'POST', body: form });
  if (!res.ok) throw new Error(`Upload imagem: ${(await res.json()).error}`);
  const { url } = await res.json();
  return url;
}

async function uploadJson(obj) {
  const res = await fetch('/api/upload', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(obj),
  });
  if (!res.ok) throw new Error(`Upload metadados: ${(await res.json()).error}`);
  const { url } = await res.json();
  return url;
}

// ─── Metadados Metaplex ───────────────────────────────────────
/**
 * buildMetadata — padrão Metaplex Token Metadata v1.1
 *
 * Campos obrigatórios para leitura pública:
 *   name, symbol, description, image → exibidos em todos os marketplaces
 *   attributes[].trait_type / value  → indexados pelo Metaplex e explorers
 *   seller_fee_basis_points          → royalties (500 = 5%)
 *   properties.creators              → criador verificável on-chain
 *
 * Qualquer usuário pode ler os atributos (lat/lng) via:
 *   1. fetchMetadataJson(nft.uri) → JSON público no IPFS
 *   2. Explorer: solscan.io → Attributes tab
 *   3. Helius DAS: getAsset(mintAddress) → attributes[]
 *
 * VALIDADO contra: https://docs.metaplex.com/programs/token-metadata/token-standard
 */
function buildMetadata({ name, description, imageUri, lat, lng, acc, fonte, artistWallet, network }) {
  return {
    // ── Campos obrigatórios (Metaplex Token Metadata Standard) ──
    name,
    symbol:      'URBAN',
    description,
    image:       imageUri,
    // Royalty: 500 basis points = 5% em cada revenda secundária
    seller_fee_basis_points: 500,

    // ── Atributos públicos — legíveis por qualquer usuário ───────
    // trait_type e value devem ser strings (padrão Metaplex/OpenSea)
    attributes: [
      // Coordenadas GPS — chave da funcionalidade do app
      { trait_type: 'Latitude',  value: lat.toFixed(6)       },
      { trait_type: 'Longitude', value: lng.toFixed(6)       },
      // Metadados adicionais
      { trait_type: 'Precisão',  value: acc > 0 ? `±${acc}m` : 'Manual' },
      { trait_type: 'Fonte GPS', value: fonte   || 'GPS'     },
      { trait_type: 'Rede',      value: network || 'devnet'  },
      { trait_type: 'Categoria', value: 'Arte Urbana'        },
    ],

    // ── Propriedades (Metaplex v1.1) ─────────────────────────────
    properties: {
      category: 'image',
      files: [
        {
          uri:  imageUri,
          type: 'image/jpeg',
          // cdn: true — opcional, indica que o arquivo está em CDN rápido
        },
      ],
      creators: [
        {
          address: artistWallet,
          share:   100,       // 100% dos royalties para o artista
          // verified é setado on-chain pelo createNft(), não aqui
        },
      ],
    },
  };
}

// ─── Mint via Metaplex UMI ────────────────────────────────────
async function mintUrbanArt({ wallet, metadataUri, name, network }) {
  const { createUmi }               = await import('@metaplex-foundation/umi-bundle-defaults');
  const { walletAdapterIdentity }   = await import('@metaplex-foundation/umi-signer-wallet-adapters');
  const { mplTokenMetadata, createNft } = await import('@metaplex-foundation/mpl-token-metadata');
  const { generateSigner, percentAmount } = await import('@metaplex-foundation/umi');

  const rpcUrl = network === 'mainnet-beta'
    ? 'https://api.mainnet-beta.solana.com'
    : 'https://api.devnet.solana.com';

  const umi = createUmi(rpcUrl)
    .use(walletAdapterIdentity(wallet))
    .use(mplTokenMetadata());

  const mintSigner = generateSigner(umi);
  await createNft(umi, {
    mint: mintSigner, name, symbol: 'URBAN', uri: metadataUri,
    sellerFeeBasisPoints: percentAmount(5), isMutable: true,
  }).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } });

  return mintSigner.publicKey.toString();
}

// ─────────────────────────────────────────────────────────────
// Componente principal
// ─────────────────────────────────────────────────────────────
export default function Home() {
  const wallet         = useWallet();
  const { connection } = useConnection();

  const [nome,         setNome]         = useState('');
  const [descricao,    setDescricao]    = useState('');
  const [imageFile,    setImageFile]    = useState(null);
  const [imagePreview, setImagePreview] = useState('');
  const [gps,          setGps]          = useState(null);
  const [isMinting,    setIsMinting]    = useState(false);
  const [mintStep,     setMintStep]     = useState(null);
  const [mintError,    setMintError]    = useState(null);
  const [mintResult,   setMintResult]   = useState(null);
  // Estado global de artes (cache + chain) via Context
  const { arts, isLoading: isLoadingArts, addArt } = useArts();

  // Debug wallet state
  useEffect(() => {
    console.group('[Urban Secure] Wallet');
    console.log('connected:',  wallet.connected);
    console.log('publicKey:',  wallet.publicKey?.toBase58() ?? 'null');
    console.log('name:',       wallet.wallet?.adapter?.name ?? 'none');
    console.log('readyState:', wallet.wallet?.adapter?.readyState ?? 'N/A');
    console.groupEnd();
  }, [wallet.connected, wallet.publicKey]);

  const handleLocationUpdate = useCallback(data => setGps(data), []);

  const handleImageChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = () => setImagePreview(reader.result);
    reader.readAsDataURL(file);
  };

  function resetForm() {
    setNome(''); setDescricao('');
    setImageFile(null); setImagePreview('');
    setMintStep(null); setMintError(null); setMintResult(null);
  }

  function handleOverlayDismiss() {
    if (mintError) { setMintError(null); setMintStep(null); setIsMinting(false); }
    else resetForm();
  }

  const handleMint = async () => {
    if (mintStep === 'success') { resetForm(); return; }
    if (mintError)              { setMintError(null); return; }

    if (!wallet.connected || !wallet.publicKey)
      return setMintError('Conecte sua carteira primeiro.');
    const gpsOk = gps && !gps.error && (gps.acc <= 50 || gps.fonte === 'Manual');
    if (!gpsOk)
      return setMintError('Aguarde o GPS calibrar ou toque no mapa para definir a posição.');
    if (!nome.trim() || !descricao.trim())
      return setMintError('Preencha nome e descrição.');
    if (!imageFile)
      return setMintError('Selecione ou fotografe a obra.');

    const network = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet';
    const artistWallet = wallet.publicKey.toBase58();
    const nftName      = `Urban Art — ${nome}`;

    setIsMinting(true);
    setMintError(null);
    setMintResult(null);

    try {
      setMintStep('upload-image');
      const resized  = await resizeImage(imageFile, 800, 0.85);
      const imageUri = await uploadFile(resized);

      setMintStep('upload-meta');
      const metadata    = buildMetadata({ name: nftName, description: descricao, imageUri,
        lat: gps.lat, lng: gps.lng, acc: gps.acc, fonte: gps.fonte, artistWallet, network });
      const metadataUri = await uploadJson(metadata);

      setMintStep('minting');
      const mintAddress = await mintUrbanArt({ wallet, metadataUri, name: nftName, network });

      setMintResult({
        address:     mintAddress,
        explorerUrl: `https://explorer.solana.com/address/${mintAddress}?cluster=${network}`,
        solscanUrl:  `https://solscan.io/token/${mintAddress}${network === 'devnet' ? '?cluster=devnet' : ''}`,
      });
      setMintStep('success');

      addArt({
        id: mintAddress, name: nftName, description: descricao,
        lat: gps.lat, lng: gps.lng, imageUrl: imageUri,
        artistWallet, timestamp: Date.now(),
      });
    } catch (err) {
      console.error('[handleMint]', err);
      setMintError(err.message || 'Erro desconhecido.');
      setMintStep(null);
    } finally {
      setIsMinting(false);
    }
  };

  const gpsOk   = gps && !gps.error && (gps.acc <= 50 || gps.fonte === 'Manual');
  const canMint = wallet.connected && gpsOk && nome.trim() && descricao.trim() && imageFile && !isMinting;
  const isBusy  = ['upload-image', 'upload-meta', 'minting'].includes(mintStep);

  const gpsClass = !gps ? 'buscando' : gps.error ? 'erro' : gpsOk ? 'ok' : 'buscando';
  const gpsLabel = !gps
    ? '📡 Aguardando GPS… ou toque no mapa'
    : gps.error ? `❌ ${gps.error}`
    : gps.fonte === 'Manual' ? '📌 Posição manual definida ✅'
    : gps.acc <= 50 ? `✅ GPS pronto — ±${gps.acc}m (${gps.fonte || 'GPS'})`
    : `🟡 Calibrando — ±${gps.acc}m, aguarde…`;

  function mintBtnLabel() {
    if (mintStep === 'success') return '✅ NFT Mintado! Registrar outra →';
    if (isBusy) {
      const s = STEPS.find(s => s.key === mintStep);
      return s ? `${s.icon} ${s.label}…` : '⏳ Processando…';
    }
    if (mintError) return '🔄 Tentar novamente';
    return '🎨 Mintar na Solana';
  }

  return (
    <>
      <Head>
        <title>Urban Secure</title>
        <meta name="description" content="Arte urbana na blockchain Solana" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        <meta name="theme-color" content="#000000" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <link rel="manifest" href="/manifest.json" />
      </Head>

      <div className="app">
        <header className="app-header">🌍 Urban Secure</header>

        {/* Mapa — já é dynamic ssr:false, mas o ClientOnly garante contexto limpo */}
        <div className="map-container">
          <MapView onLocationUpdate={handleLocationUpdate} arts={arts} isLoading={isLoadingArts} />
        </div>

        <div className="form-panel">
          <div className={`gps-status ${gpsClass}`}>{gpsLabel}</div>

          {/* Wallet — 100% client-side via WalletHandler dynamic */}
          <WalletHandler />

          <input className="field" placeholder="Nome do artista"
            value={nome} onChange={e => setNome(e.target.value)}
            maxLength={50} disabled={isBusy} />

          <textarea className="field" placeholder="Descrição da obra"
            value={descricao} onChange={e => setDescricao(e.target.value)}
            rows={2} maxLength={200} disabled={isBusy} />

          <label className="file-label" style={{ opacity: isBusy ? 0.5 : 1 }}>
            📷 {imageFile ? imageFile.name : 'Selecionar / tirar foto'}
            <input type="file" accept="image/*" capture="environment"
              onChange={handleImageChange} disabled={isBusy} style={{ display: 'none' }} />
          </label>

          {imagePreview && <img src={imagePreview} alt="Preview" className="preview" />}

          {isBusy && (
            <div className="mint-progress">
              {STEPS.map((s, i) => {
                const idx    = STEPS.findIndex(x => x.key === mintStep);
                const isDone = i < idx;
                const isAct  = s.key === mintStep;
                return (
                  <div key={s.key} className={`mint-progress-step ${isDone?'done':''} ${isAct?'active':''}`}>
                    <span className="mint-progress-icon">{isDone?'✅':isAct?s.icon:'⏳'}</span>
                    <span className="mint-progress-label">{s.label}</span>
                  </div>
                );
              })}
            </div>
          )}

          {mintError && <div className="mint-error">⚠️ {mintError}</div>}

          <button
            className={`mint-btn ${canMint || mintStep === 'success' || mintError ? 'active' : ''} ${mintStep === 'success' ? 'success' : ''} ${isBusy ? 'minting' : ''}`}
            onClick={handleMint}
            disabled={isBusy}
          >
            {mintBtnLabel()}
          </button>

          {mintResult && mintStep === 'success' && (
            <div className="mint-result">
              <p>🎉 Arte registrada na blockchain Solana!</p>
              <p className="mint-address">{mintResult.address.slice(0,12)}…{mintResult.address.slice(-8)}</p>
              <div className="mint-links">
                <a href={mintResult.explorerUrl} target="_blank" rel="noreferrer">Explorer ↗</a>
                <a href={mintResult.solscanUrl}  target="_blank" rel="noreferrer">Solscan ↗</a>
              </div>
            </div>
          )}

          <p className="network-badge">
            Rede: {process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet'} · IPFS: Pinata
          </p>
        </div>
      </div>

      <MintOverlay
        visible={isMinting || mintStep === 'success' || !!mintError}
        step={mintStep}
        error={mintError}
        onDismiss={handleOverlayDismiss}
      />
    </>
  );
}
