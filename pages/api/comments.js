/**
 * pages/api/comments.js
 * Comentários de texto (sem pagamento) — Pinata/IPFS.
 * GET  ?postId=...                             → lista de comentários de uma obra
 * POST { postId, wallet, text, timestamp, signature } → adiciona um comentário
 *       (a wallet precisa assinar a mensagem pra provar autoria)
 */

import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { getLatestPin, savePin } from '../../lib/pinataStore';
import { sanitize } from '../../lib/sanitize';
import { buildCommentMessage } from '../../lib/commentSignature';

const COMMENTS_REGISTRY_NAME = 'urban-secure-comments-v1';
const SOLANA_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// Janela de tolerância para o timestamp assinado — evita reuso de assinaturas antigas
const SIGNATURE_WINDOW_MS = 10 * 60 * 1000;
// Intervalo mínimo entre comentários da mesma wallet no mesmo post — anti-spam
const MIN_INTERVAL_MS = 5 * 1000;

function verifyCommentSignature({ postId, wallet, text, timestamp, signature }) {
  try {
    const sigBytes = Buffer.from(signature, 'base64');
    if (sigBytes.length !== 64) return false;
    const pubkeyBytes = bs58.decode(wallet);
    if (pubkeyBytes.length !== 32) return false;
    const message = buildCommentMessage({ postId, wallet, text, timestamp });
    const msgBytes = new TextEncoder().encode(message);
    return nacl.sign.detached.verify(msgBytes, sigBytes, pubkeyBytes);
  } catch {
    return false;
  }
}

async function getLatestComments(jwt) {
  const comments = await getLatestPin(jwt, COMMENTS_REGISTRY_NAME, {});
  return (comments && typeof comments === 'object') ? comments : {};
}

export default async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const jwt = process.env.PINATA_JWT;
  if (!jwt) return res.status(500).json({ error: 'Servidor não configurado.' });

  if (req.method === 'GET') {
    const { postId } = req.query;
    if (!postId || !SOLANA_ADDR_RE.test(postId)) {
      return res.status(400).json({ error: 'postId inválido.' });
    }
    const comments = await getLatestComments(jwt);
    const list = comments[postId] || [];
    res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=120');
    return res.status(200).json({ comments: list, count: list.length });
  }

  if (req.method === 'POST') {
    try {
      const { postId, wallet, text, timestamp, signature } = req.body || {};

      if (!postId || !SOLANA_ADDR_RE.test(postId)) return res.status(400).json({ error: 'postId inválido.' });
      if (!wallet || !SOLANA_ADDR_RE.test(wallet))  return res.status(400).json({ error: 'wallet inválida.' });

      const safeText = sanitize(text, 300);
      if (!safeText) return res.status(400).json({ error: 'Comentário vazio.' });

      if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > SIGNATURE_WINDOW_MS) {
        return res.status(400).json({ error: 'Timestamp inválido ou expirado. Tente comentar novamente.' });
      }
      if (typeof signature !== 'string' || !signature) {
        return res.status(401).json({ error: 'Assinatura da carteira ausente.' });
      }
      if (!verifyCommentSignature({ postId, wallet, text, timestamp, signature })) {
        return res.status(401).json({ error: 'Assinatura inválida — a carteira não confirmou este comentário.' });
      }

      const comments = await getLatestComments(jwt);
      const list = comments[postId] || [];

      const last = [...list].reverse().find(c => c.wallet === wallet);
      if (last && Date.now() - last.timestamp < MIN_INTERVAL_MS) {
        return res.status(429).json({ error: 'Aguarde alguns segundos antes de comentar de novo.' });
      }

      list.push({ wallet, text: safeText, timestamp: Date.now() });
      comments[postId] = list;

      const saved = await savePin(jwt, COMMENTS_REGISTRY_NAME, comments);
      if (!saved) return res.status(502).json({ error: 'Falha ao salvar comentário.' });

      return res.status(200).json({ ok: true, count: list.length });
    } catch (err) {
      console.error('[/api/comments POST]', err.message);
      return res.status(500).json({ error: 'Erro ao comentar.' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export const config = {
  maxDuration: 10,
};
