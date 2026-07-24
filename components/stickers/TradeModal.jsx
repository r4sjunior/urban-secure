/**
 * components/stickers/TradeModal.jsx
 * Propor e responder trocas de figurinhas repetidas.
 *
 * O fluxo tem um passo que não dá pra esconder: antes de propor ou aceitar, a
 * figurinha PRECISA ir para a custódia (uma transação real, assinada na
 * carteira). É o que torna a troca segura — nenhum lado entrega sem o outro
 * ter entregado (ver o topo de pages/api/trades.js). A tela explica isso em
 * vez de disfarçar, porque o usuário vai ver a carteira pedir assinatura de
 * qualquer forma, e surpresa nesse momento gera desconfiança.
 */

import { useState, useEffect, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { transferNft } from '../../lib/nftTransfer';
import {
  buildProposeTradeMessage, buildRespondTradeMessage,
} from '../../lib/stickers/tradeSignature';
import { shortWallet } from '../../lib/social/profile';
import { sound } from '../../lib/sound';
import StickerCard from './StickerCard';

export default function TradeModal({ open, onClose, duplicates, canTrade, onDone }) {
  const wallet = useWallet();
  const address = wallet.publicKey?.toBase58() || '';

  const [tab, setTab] = useState('received'); // 'received' | 'sent' | 'new'
  const [trades, setTrades] = useState({ received: [], sent: [], vaultAddress: '' });
  const [busy, setBusy] = useState(null); // id da proposta em processamento
  const [step, setStep] = useState('');   // texto do passo atual
  const [error, setError] = useState(null);

  // Proposta nova
  const [offered, setOffered] = useState(null);
  const [targetWallet, setTargetWallet] = useState('');
  const [targetMint, setTargetMint] = useState('');

  const load = useCallback(async () => {
    if (!address) return;
    try {
      const res = await fetch(`/api/trades?wallet=${encodeURIComponent(address)}`);
      const json = await res.json();
      if (res.ok) setTrades(json);
    } catch (err) {
      console.error('[TradeModal]', err.message);
    }
  }, [address]);

  useEffect(() => { if (open) { load(); setError(null); } }, [open, load]);

  if (!open) return null;

  async function sign(message) {
    const sigBytes = await wallet.signMessage(new TextEncoder().encode(message));
    return Buffer.from(sigBytes).toString('base64');
  }

  /** Deposita a figurinha na custódia. Passo comum a propor e aceitar. */
  async function depositar(mint) {
    setStep('Enviando a figurinha para a custódia…');
    await transferNft({ wallet, mint, destination: trades.vaultAddress });
  }

  async function handlePropose() {
    if (!offered || !targetWallet || !targetMint) {
      setError('Escolha o que oferecer e a figurinha que você quer.');
      return;
    }

    setBusy('new');
    setError(null);
    try {
      await depositar(offered.mint);

      setStep('Registrando a proposta…');
      const timestamp = Date.now();
      const signature = await sign(buildProposeTradeMessage({
        fromWallet: address, toWallet: targetWallet.trim(),
        offeredMint: offered.mint, requestedMint: targetMint.trim(), timestamp,
      }));

      const res = await fetch('/api/trades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'propose', wallet: address, toWallet: targetWallet.trim(),
          offeredMint: offered.mint, requestedMint: targetMint.trim(), timestamp, signature,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);

      sound.play('success');
      setOffered(null); setTargetWallet(''); setTargetMint('');
      setTab('sent');
      await load();
      onDone?.();
    } catch (err) {
      sound.play('error');
      setError(/rejected|cancel/i.test(err?.message || '') ? 'Ação cancelada na carteira.' : err.message);
    } finally {
      setBusy(null); setStep('');
    }
  }

  async function handleRespond(trade, decision) {
    setBusy(trade.id);
    setError(null);
    try {
      // Aceitar exige depositar a figurinha pedida primeiro — o servidor só
      // distribui depois de confirmar que a vault tem as duas.
      if (decision === 'accept') await depositar(trade.requestedMint);

      setStep(decision === 'accept' ? 'Concluindo a troca…' : 'Processando…');
      const timestamp = Date.now();
      const signature = await sign(buildRespondTradeMessage({
        tradeId: trade.id, wallet: address, decision, timestamp,
      }));

      const res = await fetch('/api/trades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: decision === 'accept' ? 'accept' : decision === 'cancel' ? 'cancel' : 'decline',
          wallet: address, tradeId: trade.id, timestamp, signature,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);

      sound.play('success');
      await load();
      onDone?.();
    } catch (err) {
      sound.play('error');
      setError(/rejected|cancel/i.test(err?.message || '') ? 'Ação cancelada na carteira.' : err.message);
    } finally {
      setBusy(null); setStep('');
    }
  }

  const pendentesRecebidas = trades.received.filter(t => t.status === 'pendente');
  const pendentesEnviadas = trades.sent.filter(t => t.status === 'pendente');

  return (
    <div className="transfer-modal">
      <div className="transfer-backdrop" onClick={() => !busy && onClose()} />

      <div className="transfer-panel">
        <div className="sheet-handle" onClick={() => !busy && onClose()} />
        <h2 className="sheet-title">Trocar Figurinhas</h2>
        <p className="sheet-sub">Só as repetidas podem ser trocadas. As coladas ficam no álbum.</p>

        {!canTrade ? (
          <p className="transfer-empty">
            Complete 7 dias seguidos de claim para liberar as trocas.
          </p>
        ) : (
          <>
            <div className="rank-tabs">
              <button className={`rank-tab${tab === 'received' ? ' on' : ''}`} onClick={() => setTab('received')}>
                Recebidas{pendentesRecebidas.length > 0 && ` (${pendentesRecebidas.length})`}
              </button>
              <button className={`rank-tab${tab === 'sent' ? ' on' : ''}`} onClick={() => setTab('sent')}>
                Enviadas{pendentesEnviadas.length > 0 && ` (${pendentesEnviadas.length})`}
              </button>
              <button className={`rank-tab${tab === 'new' ? ' on' : ''}`} onClick={() => setTab('new')}>
                Propor
              </button>
            </div>

            {step && <div className="trade-step">⏳ {step}</div>}
            {error && <div className="err-box">⚠️ {error}</div>}

            {tab === 'received' && (
              pendentesRecebidas.length === 0
                ? <p className="transfer-empty">Nenhuma proposta recebida.</p>
                : pendentesRecebidas.map(t => (
                    <div className="trade-row" key={t.id}>
                      <div className="trade-info">
                        <strong>{shortWallet(t.fromWallet)}</strong> quer trocar
                        <span className="trade-mints">
                          oferece {shortWallet(t.offeredMint)} · quer {shortWallet(t.requestedMint)}
                        </span>
                      </div>
                      <div className="trade-actions">
                        <button className="btn-ghost" onClick={() => handleRespond(t, 'accept')} disabled={!!busy}>
                          Aceitar
                        </button>
                        <button className="btn-ghost btn-ghost-danger" onClick={() => handleRespond(t, 'decline')} disabled={!!busy}>
                          Recusar
                        </button>
                      </div>
                    </div>
                  ))
            )}

            {tab === 'sent' && (
              pendentesEnviadas.length === 0
                ? <p className="transfer-empty">Nenhuma proposta enviada.</p>
                : pendentesEnviadas.map(t => (
                    <div className="trade-row" key={t.id}>
                      <div className="trade-info">
                        Para <strong>{shortWallet(t.toWallet)}</strong>
                        <span className="trade-mints">
                          aguardando resposta · expira em{' '}
                          {Math.max(0, Math.round((t.expiresAt - Date.now()) / 3600000))}h
                        </span>
                      </div>
                      <div className="trade-actions">
                        <button className="btn-ghost btn-ghost-danger" onClick={() => handleRespond(t, 'cancel')} disabled={!!busy}>
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ))
            )}

            {tab === 'new' && (
              duplicates.length === 0 ? (
                <p className="transfer-empty">
                  Você não tem figurinhas repetidas para oferecer.
                </p>
              ) : (
                <>
                  <span className="form-legend">O que você oferece</span>
                  <div className="album-dupes">
                    {duplicates.map(s => (
                      <StickerCard
                        key={s.mint}
                        sticker={s}
                        size="sm"
                        showArtist={false}
                        faded={offered && offered.mint !== s.mint}
                        onClick={() => setOffered(s)}
                      />
                    ))}
                  </div>

                  <span className="form-legend">Para quem</span>
                  <input
                    className="fld"
                    placeholder="Carteira do outro colecionador"
                    value={targetWallet}
                    onChange={e => setTargetWallet(e.target.value)}
                    disabled={!!busy}
                  />
                  <input
                    className="fld"
                    placeholder="Mint da figurinha que você quer"
                    value={targetMint}
                    onChange={e => setTargetMint(e.target.value)}
                    disabled={!!busy}
                  />

                  <p className="capture-note">
                    Ao propor, sua figurinha vai para a custódia do app. Se a proposta
                    for recusada, cancelada ou expirar, ela volta para você.
                  </p>

                  <button className="mint-cta" onClick={handlePropose} disabled={!!busy || !offered}>
                    {busy === 'new' ? '⏳ Processando…' : '🔄 Propor troca'}
                  </button>
                </>
              )
            )}
          </>
        )}
      </div>
    </div>
  );
}
