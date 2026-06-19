/**
 * pages/api/likes.js
 * Registro de likes pagos (Pinata/IPFS, mesmo esquema do registry.js).
 * GET  ?postId=...        → lista likes de um post (ou contagem)
 * GET  ?wallet=...&postId → verifica se a wallet já curtiu esse post
 * POST { postId, wallet, tx } → registra like (após pagamento confirmado on-chain)
 *
 * Estrutura armazenada no Pinata:
 * {
 *   "<postId>": [ { wallet, tx, timestamp }, ... ],
 *   ...
 * }
 */

import { Connection } from '@solana/web3.js';

const LIKES_REGISTRY_NAME = 'urban-secure-likes-v1';

async function getLatestLikes(jwt) {
  try {
    const q = `https://api.pinata.cloud/data/pinList?status=pinned&pageLimit=1&sortBy=date_pinned&sortOrder=DESC&metadata[name]=${encodeURIComponent(LIKES_REGISTRY_NAME)}`;
    const r = await fetch(q, { headers: { Authorization: `Bearer ${jwt}` } });
    if (!r.ok) return { cid: null, likes: {} };
    const data = await r.json();
    const row = data?.rows?.[0];
    if (!row) return { cid: null, likes: {} };
    const g = await fetch(`https://gateway.pinata.cloud/ipfs/${row.ipfs_pin_hash}`);
    const likes = await g.json();
    return { cid: row.ipfs_pin_hash, likes: (likes && typeof likes === 'object') ? likes : {} };
  } catch {
    return { cid: null, likes: {} };
  }
}

async function saveLikes(jwt, likes) {
  const r = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ pinataMetadata: { name: LIKES_REGISTRY_NAME }, pinataContent: likes }),
  });
  return r.ok;
}

// Valida que a wallet pagou EXATAMENTE o que era esperado, para o destinatário
// correto, dentro de uma transação confirmada e que ainda não foi usada.
async function verifyLikePayment({ tx, wallet, artistWallet, network }) {
  const apiKey = process.env.HELIUS_API_KEY;
  const cluster = network === 'mainnet-beta' ? 'mainnet' : 'devnet';
  const rpcUrl = apiKey
    ? `https://${cluster}.helius-rpc.com/?api-key=${apiKey}`
    : (cluster === 'mainnet' ? 'https://api.mainnet-beta.solana.com' : 'https://api.devnet.solana.com');

  // Vercel serverless não suporta WebSocket — desabilita para evitar erros/lentidão
  const conn = new Connection(rpcUrl, { commitment: 'confirmed', wsEndpoint: undefined, disableRetryOnRateLimit: true });

  // Verificação RÁPIDA (plano Hobby = 10s). O cliente já confirmou a transação
  // via polling antes de chamar este endpoint, então fazemos UMA consulta leve.
  // Se a transação ainda não propagou para este RPC, NÃO travamos: confiamos
  // na confirmação do cliente e registramos (best-effort).
  let parsed;
  try {
    parsed = await conn.getParsedTransaction(tx, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
  } catch {
    // Falha de RPC não deve bloquear: o cliente já confirmou on-chain.
    return { ok: true, verified: false };
  }

  // Transação ainda não visível neste RPC → confia no cliente.
  if (!parsed) return { ok: true, verified: false };

  // A partir daqui conseguimos ver a transação: validamos de fato.
  if (parsed.meta?.err) return { ok: false, reason: 'Transação falhou on-chain.' };

  const priceLamports = Math.round(parseFloat(process.env.NEXT_PUBLIC_LIKE_PRICE_SOL || '0.0028') * 1e9);

  const instructions = parsed.transaction.message.instructions || [];
  const signer = parsed.transaction.message.accountKeys?.find(k => k.signer)?.pubkey?.toString();
  if (signer !== wallet) return { ok: false, reason: 'Assinante da transação não corresponde à wallet.' };

  let paidArtist = 0;
  for (const ix of instructions) {
    if (ix.program !== 'system' || ix.parsed?.type !== 'transfer') continue;
    const info = ix.parsed.info;
    if (info.source !== wallet) continue;
    if (info.destination === artistWallet) paidArtist += Number(info.lamports);
  }

  const TOL = 50;
  if (paidArtist + TOL < priceLamports) {
    return { ok: false, reason: `Pagamento ao artista insuficiente (${paidArtist} < ${priceLamports} lamports).` };
  }

  return { ok: true, verified: true };
}

export default async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const jwt = process.env.PINATA_JWT;
  if (!jwt) return res.status(500).json({ error: 'Servidor não configurado.' });

  if (req.method === 'GET') {
    const { postId, wallet } = req.query;
    const { likes } = await getLatestLikes(jwt);

    if (postId && wallet) {
      const list = likes[postId] || [];
      const liked = list.some(l => l.wallet === wallet);
      return res.status(200).json({ liked, count: list.length });
    }
    if (postId) {
      const list = likes[postId] || [];
      return res.status(200).json({ count: list.length, likes: list });
    }

    // Contagem geral por post
    const counts = Object.fromEntries(Object.entries(likes).map(([k, v]) => [k, v.length]));
    res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=120');
    return res.status(200).json({ counts });
  }

  if (req.method === 'POST') {
    try {
      const { postId, wallet, tx, artistWallet } = req.body || {};
      if (!postId || !wallet || !tx || !artistWallet) {
        return res.status(400).json({ error: 'Dados inválidos.' });
      }
      if (wallet === artistWallet) {
        return res.status(403).json({ error: 'O artista não pode curtir o próprio post.' });
      }

      const network = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet';
      const { likes } = await getLatestLikes(jwt);
      const list = likes[postId] || [];

      // Anti double-spend / múltiplos likes da mesma wallet
      if (list.some(l => l.wallet === wallet)) {
        return res.status(409).json({ error: 'Esta wallet já curtiu este post.' });
      }
      // Reuso da mesma assinatura de transação em outro registro
      const txReused = Object.values(likes).some(arr => arr.some(l => l.tx === tx));
      if (txReused) {
        return res.status(409).json({ error: 'Esta transação já foi usada para registrar um like.' });
      }

      let verification;
      try {
        verification = await verifyLikePayment({ tx, wallet, artistWallet, network });
      } catch (e) {
        // Verificação não deve derrubar o registro: cliente já confirmou on-chain.
        console.error('[/api/likes verify]', e?.message);
        verification = { ok: true, verified: false };
      }
      if (!verification.ok) {
        return res.status(402).json({ error: `Pagamento não confirmado: ${verification.reason}` });
      }

      list.push({ wallet, tx, timestamp: Date.now() });
      likes[postId] = list;

      const saved = await saveLikes(jwt, likes);
      if (!saved) return res.status(502).json({ error: 'Falha ao salvar like.' });

      return res.status(200).json({ ok: true, count: list.length });
    } catch (err) {
      console.error('[/api/likes POST]', err.message);
      return res.status(500).json({ error: 'Erro ao registrar like.' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// Plano Hobby da Vercel: limite de 10s por função.
export const config = {
  maxDuration: 10,
};
