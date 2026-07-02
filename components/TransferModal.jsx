/**
 * components/TransferModal.jsx
 * Transfere um NFT URBAN da carteira conectada para outro endereço Solana.
 * Usa o proxy RPC (Helius) — mais confiável que o envio pelo Phantom.
 */
import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useMyNfts } from '../lib/useMyNfts';
import { transferNft } from '../lib/nftTransfer';

export default function TransferModal({ open, onClose }) {
  const wallet = useWallet();
  const { nfts, loading, removeNft } = useMyNfts(wallet, open);
  const [selected, setSelected] = useState(null);
  const [destino, setDestino] = useState('');
  const [status, setStatus] = useState(null); // null | 'sending' | 'ok' | erro string

  function validarEndereco(addr) {
    // Endereço Solana: base58, 32-44 chars
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr.trim());
  }

  async function handleTransfer() {
    if (!selected) return setStatus('Selecione uma arte.');
    if (!validarEndereco(destino)) return setStatus('Endereço Solana inválido.');

    setStatus('sending');
    try {
      await transferNft({ wallet, mint: selected, destination: destino.trim() });

      setStatus('ok');
      removeNft(selected);
      setSelected(null);
      setDestino('');
    } catch (err) {
      console.error('[Transfer] erro completo:', err);
      let msg = err?.message || 'Erro ao transferir.';
      if (msg.includes('insufficient')) msg = 'Saldo insuficiente para a taxa.';
      else if (msg.includes('rejected') || msg.includes('User rejected')) msg = 'Transação cancelada.';
      else if (msg.includes('confirmação demorou')) msg = msg;
      else if (msg.includes('expired') || msg.includes('block height')) msg = 'A rede demorou a confirmar. Verifique sua carteira antes de tentar de novo.';
      else msg = 'Não foi possível transferir. Tente novamente.';
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
