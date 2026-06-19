/**
 * components/LikeButton.jsx
 * Botão de "like pago" — conecta wallet, assina pagamento (100% ao artista),
 * registra no backend e bloqueia múltiplos likes da mesma wallet.
 */
import { useState, useEffect, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { payForLike, getLikePriceSol } from '../lib/likePayment';

// Lê a resposta com segurança: se o servidor devolver HTML (erro/timeout),
// não quebra no JSON.parse — devolve uma mensagem tratável.
async function safeJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    if (res.status === 504 || /timeout/i.test(text)) {
      throw new Error('O servidor demorou para responder. Seu pagamento pode ter sido feito — verifique no Solscan antes de tentar de novo.');
    }
    throw new Error('Resposta inválida do servidor. Tente novamente em instantes.');
  }
}

export default function LikeButton({ postId, artistWallet, initialCount = 0, wallet: injectedWallet }) {
  const contextWallet = useWallet();
  const wallet = injectedWallet || contextWallet;
  const [liked, setLiked] = useState(false);
  const [count, setCount] = useState(initialCount);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [checked, setChecked] = useState(false);

  const isOwnPost = wallet.publicKey && artistWallet === wallet.publicKey.toBase58();

  // Verifica se a wallet já curtiu este post
  useEffect(() => {
    let active = true;
    async function check() {
      if (!wallet.publicKey || !postId) { setChecked(true); return; }
      try {
        const r = await fetch(`/api/likes?postId=${encodeURIComponent(postId)}&wallet=${encodeURIComponent(wallet.publicKey.toBase58())}`);
        const data = await safeJson(r);
        if (!active) return;
        setLiked(!!data.liked);
        setCount(data.count ?? initialCount);
      } catch {
        // silencioso — não bloqueia a UI
      } finally {
        if (active) setChecked(true);
      }
    }
    check();
    return () => { active = false; };
  }, [wallet.publicKey, postId, initialCount]);

  const handleLike = useCallback(async () => {
    setError(null);

    if (!wallet.connected || !wallet.publicKey) {
      setError('Conecte sua carteira para curtir.');
      return;
    }
    if (isOwnPost) {
      setError('Você não pode curtir o próprio post.');
      return;
    }
    if (liked) return;

    setLoading(true);
    try {
      const tx = await payForLike(wallet, artistWallet);

      const r = await fetch('/api/likes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId, wallet: wallet.publicKey.toBase58(), tx, artistWallet }),
      });
      const data = await safeJson(r);
      if (!r.ok) throw new Error(data.error || 'Falha ao registrar like.');

      setLiked(true);
      setCount(data.count ?? (count + 1));
    } catch (err) {
      console.error('[LikeButton]', err);
      let msg = err.message || 'Erro ao processar like.';
      if (msg.includes('insufficient') || msg.includes('0x1')) msg = 'Saldo insuficiente para pagar o like.';
      else if (msg.includes('rejected') || msg.includes('User rejected')) msg = 'Transação cancelada na carteira.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [wallet, liked, isOwnPost, postId, artistWallet, count]);

  return (
    <div className="like-button-wrap">
      <button
        className={`like-btn ${liked ? 'liked' : ''}`}
        onClick={handleLike}
        disabled={loading || liked || isOwnPost || !checked}
        title={isOwnPost ? 'Você não pode curtir o próprio post' : `Curtir por ${getLikePriceSol()} SOL`}
      >
        {loading ? '⏳' : liked ? '❤️' : '🤍'} {count}
      </button>
      {error && <div className="like-error">⚠️ {error}</div>}
      {!liked && !isOwnPost && (
        <span className="like-price">{getLikePriceSol()} SOL</span>
      )}
    </div>
  );
}
