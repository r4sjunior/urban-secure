/**
 * components/CommentsSection.jsx
 * Comentários de texto por obra — grátis, mas exige assinatura da carteira
 * (prova de autoria) pra publicar. Lista carregada de forma preguiçosa,
 * só na primeira vez que o usuário expande a seção.
 */
import { useState, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { buildCommentMessage } from '../lib/commentSignature';
import { timeAgo } from '../lib/timeAgo';

const MAX_LEN = 300;

function shortWallet(w) {
  if (!w) return '?';
  return `${w.slice(0, 4)}…${w.slice(-4)}`;
}

export default function CommentsSection({ postId, isAuthenticated = false }) {
  const wallet = useWallet();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [comments, setComments] = useState([]);
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState(null);

  const loadComments = useCallback(async () => {
    try {
      const r = await fetch(`/api/comments?postId=${encodeURIComponent(postId)}`);
      const data = await r.json();
      setComments(Array.isArray(data.comments) ? data.comments : []);
    } catch {
      // silencioso — não bloqueia a UI
    } finally {
      setLoaded(true);
    }
  }, [postId]);

  const handleToggle = useCallback(() => {
    setOpen(o => {
      const next = !o;
      if (next && !loaded) loadComments();
      return next;
    });
  }, [loaded, loadComments]);

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    setError(null);
    const trimmed = text.trim();
    if (!trimmed) return;

    if (!wallet.connected || !wallet.publicKey) { setError('Conecte sua carteira para comentar.'); return; }
    if (!isAuthenticated) { setError('Assine na carteira para comentar.'); return; }
    if (!wallet.signMessage) { setError('Esta carteira não suporta assinatura de mensagem.'); return; }

    setPosting(true);
    try {
      const walletAddr = wallet.publicKey.toBase58();
      const timestamp = Date.now();
      const message = buildCommentMessage({ postId, wallet: walletAddr, text: trimmed, timestamp });
      const sigBytes = await wallet.signMessage(new TextEncoder().encode(message));
      const signature = Buffer.from(sigBytes).toString('base64');

      const r = await fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId, wallet: walletAddr, text: trimmed, timestamp, signature }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Falha ao publicar comentário.');

      setComments(prev => [...prev, { wallet: walletAddr, text: trimmed, timestamp: Date.now() }]);
      setText('');
    } catch (err) {
      console.error('[CommentsSection]', err);
      const msg = err.message || 'Erro ao comentar.';
      setError(msg.includes('rejected') || msg.includes('User rejected') ? 'Assinatura cancelada.' : msg);
    } finally {
      setPosting(false);
    }
  }, [text, wallet, isAuthenticated, postId]);

  return (
    <div className="comments-section">
      <button className="comments-toggle" onClick={handleToggle}>
        💬 Comentários{loaded ? ` (${comments.length})` : ''}
      </button>

      {open && (
        <div className="comments-body">
          <div className="comments-list">
            {loaded && comments.length === 0 && (
              <p className="comments-empty">Nenhum comentário ainda.</p>
            )}
            {comments.map((c, i) => (
              <div className="comment-item" key={`${c.wallet}-${c.timestamp}-${i}`}>
                <span className="comment-wallet">{shortWallet(c.wallet)}</span>
                <span className="comment-text">{c.text}</span>
                <span className="comment-time">{timeAgo(c.timestamp)}</span>
              </div>
            ))}
          </div>

          {wallet.connected && !isAuthenticated ? (
            <div className="auth-hint">✍️ Assine na carteira para comentar.</div>
          ) : (
            <form className="comment-input-row" onSubmit={handleSubmit}>
              <input
                className="fld comment-input"
                placeholder={wallet.connected ? 'Escreva um comentário…' : 'Conecte sua carteira para comentar'}
                value={text}
                onChange={e => setText(e.target.value.slice(0, MAX_LEN))}
                disabled={posting || !wallet.connected}
                maxLength={MAX_LEN}
              />
              <button className="comment-send" type="submit" disabled={posting || !text.trim() || !wallet.connected}>
                {posting ? '⏳' : '➤'}
              </button>
            </form>
          )}
          {error && <div className="like-error">⚠️ {error}</div>}
        </div>
      )}
    </div>
  );
}
