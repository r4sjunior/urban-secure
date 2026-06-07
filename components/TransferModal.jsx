/**
 * components/TransferModal.jsx
 * Transfere um NFT URBAN da carteira conectada para outro endereço Solana.
 * Usa o proxy RPC (Helius) — mais confiável que o envio pelo Phantom.
 */
import { useState, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';

export default function TransferModal({ open, onClose }) {
  const wallet = useWallet();
  const [nfts, setNfts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const [destino, setDestino] = useState('');
  const [status, setStatus] = useState(null); // null | 'sending' | 'ok' | erro string

  // Carrega os NFTs URBAN da carteira conectada
  useEffect(() => {
    if (!open || !wallet.publicKey) return;
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

        // Busca a imagem de cada NFT no metadata JSON (IPFS)
        const urban = await Promise.all(urbanAssets.map(async (a) => {
          let imageUrl = '';
          try {
            const res = await fetch(a.metadata.uri);
            const json = await res.json();
            imageUrl = (json.image || '').startsWith('https://') ? json.image : '';
          } catch {}
          return { id: a.publicKey.toString(), name: a.metadata.name, uri: a.metadata.uri, imageUrl };
        }));
        if (!cancel) setNfts(urban);
      } catch (err) {
        console.error('[Transfer] load', err);
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [open, wallet.publicKey]);

  function validarEndereco(addr) {
    // Endereço Solana: base58, 32-44 chars
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr.trim());
  }

  async function handleTransfer() {
    if (!selected) return setStatus('Selecione uma arte.');
    if (!validarEndereco(destino)) return setStatus('Endereço Solana inválido.');

    setStatus('sending');
    try {
      const { createUmi } = await import('@metaplex-foundation/umi-bundle-defaults');
      const { walletAdapterIdentity } = await import('@metaplex-foundation/umi-signer-wallet-adapters');
      const { mplTokenMetadata, transferV1, fetchDigitalAsset, TokenStandard } = await import('@metaplex-foundation/mpl-token-metadata');
      const { publicKey } = await import('@metaplex-foundation/umi');
      const { setComputeUnitPrice } = await import('@metaplex-foundation/mpl-toolbox');

      const umi = createUmi(`${window.location.origin}/api/rpc`)
        .use(walletAdapterIdentity(wallet)).use(mplTokenMetadata());

      const destPk = publicKey(destino.trim());
      const asset = await fetchDigitalAsset(umi, publicKey(selected));

      let ts = TokenStandard.NonFungible;
      const onChainTs = asset?.metadata?.tokenStandard;
      if (onChainTs && onChainTs.__option === 'Some') ts = onChainTs.value;

      // Verifica se o NFT já saiu da carteira (transferência confirmada)
      async function jaTransferiu() {
        try {
          const { fetchAllDigitalAssetWithTokenByOwner } = await import('@metaplex-foundation/mpl-token-metadata');
          const restantes = await fetchAllDigitalAssetWithTokenByOwner(umi, umi.identity.publicKey);
          return !restantes.some(a => a.publicKey.toString() === selected);
        } catch { return false; }
      }

      // Blockhash fresco 'finalized' (janela maior)
      const blockhash = await umi.rpc.getLatestBlockhash({ commitment: 'finalized' });

      let builder = transferV1(umi, {
        mint: publicKey(selected),
        authority: umi.identity,
        tokenOwner: umi.identity.publicKey,
        destinationOwner: destPk,
        tokenStandard: ts,
      });
      try { builder = builder.prepend(setComputeUnitPrice(umi, { microLamports: 200000 })); } catch {}
      builder = builder.setBlockhash(blockhash);

      try {
        await builder.sendAndConfirm(umi, {
          confirm: { commitment: 'confirmed' },
          send: { skipPreflight: true, maxRetries: 5 },
        });
      } catch (errSend) {
        const m = String(errSend?.message || '');
        if (m.includes('expired') || m.includes('block height')) {
          // Pode ter confirmado mesmo assim — verifica
          await new Promise(r => setTimeout(r, 8000));
          const ok = await jaTransferiu();
          if (!ok) throw new Error('A confirmação demorou. Verifique sua carteira antes de tentar de novo.');
        } else {
          throw errSend;
        }
      }

      setStatus('ok');
      setNfts(prev => prev.filter(n => n.id !== selected));
      setSelected(null);
      setDestino('');
    } catch (err) {
      console.error('[Transfer] erro completo:', err);
      let msg = err?.message || 'Erro ao transferir.';
      if (msg.includes('insufficient')) msg = 'Saldo insuficiente para a taxa.';
      else if (msg.includes('rejected') || msg.includes('User rejected')) msg = 'Transação cancelada.';
      else if (msg.includes('confirmação demorou')) msg = msg; // mantém mensagem clara
      else msg = `Erro: ${msg.slice(0, 150)}`;
      setStatus(msg);
    }
  }

  if (!open) return null;

  return (
    <div className="transfer-modal">
      <div className="transfer-backdrop" onClick={() => status !== 'sending' && onClose()} />
      <div className="transfer-panel">
        <div className="sheet-handle" onClick={() => status !== 'sending' && onClose()} />
        <h2 className="sheet-title">Enviar Arte</h2>
        <p className="sheet-sub">Transfira um NFT para outra carteira Solana.</p>

        {!wallet.connected ? (
          <p className="transfer-empty">Conecte sua carteira primeiro.</p>
        ) : loading ? (
          <p className="transfer-empty">Carregando suas artes…</p>
        ) : nfts.length === 0 ? (
          <p className="transfer-empty">Você não tem artes URBAN nesta carteira.</p>
        ) : (
          <>
            <div className="transfer-list">
              {nfts.map(n => (
                <button
                  key={n.id}
                  className={`transfer-item ${selected === n.id ? 'sel' : ''}`}
                  onClick={() => { setSelected(n.id); setStatus(null); }}
                >
                  <div className="transfer-item-thumb">
                    {n.imageUrl
                      ? <img src={n.imageUrl} alt="" onError={(e)=>{e.target.style.display='none';e.target.parentNode.textContent='🎨';}} />
                      : '🎨'}
                  </div>
                  <div className="transfer-item-info">
                    <span className="transfer-item-name">{n.name}</span>
                    <span className="transfer-item-id">{n.id.slice(0,4)}…{n.id.slice(-4)}</span>
                  </div>
                  {selected === n.id && <span className="transfer-item-check">✓</span>}
                </button>
              ))}
            </div>

            <input
              className="fld"
              placeholder="Endereço Solana do destinatário"
              value={destino}
              onChange={e => { setDestino(e.target.value); setStatus(null); }}
              disabled={status === 'sending'}
            />

            {status === 'ok' && <div className="transfer-ok">✅ Arte enviada com sucesso!</div>}
            {status && status !== 'sending' && status !== 'ok' && <div className="err-box">⚠️ {status}</div>}

            <button className="mint-cta" onClick={handleTransfer} disabled={status === 'sending'}>
              {status === 'sending' ? '⏳ Enviando…' : '📤 Enviar Arte'}
            </button>
            <p className="fee-note">Você paga apenas a taxa de gás (~0.001 SOL)</p>
          </>
        )}
      </div>
    </div>
  );
}
