/**
 * pages/api/likes.js
 * Registro de likes pagos (Pinata/IPFS).
 * GET  ?postId=...        → lista likes de um post (ou contagem)
 * GET  ?wallet=...&postId → verifica se a wallet já curtiu esse post
 * POST { postId, wallet, tx } → registra like (após pagamento confirmado on-chain)
 */

const LIKES_REGISTRY_NAME = 'urban-secure-likes-v1';

// Endereço Solana: base58, 32-44 chars
const SOLANA_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
// Assinatura de transação Solana: base58, ~87-88 chars (64 bytes)
const SOLANA_TX_RE   = /^[1-9A-HJ-NP-Za-km-z]{86,90}$/;

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

/**
 * Verifica que a transação existe on-chain, foi assinada pela wallet correta,
 * e pagou o artista o valor esperado.
 *
 * SEGURANÇA: Não aceita like se a transação não for encontrada ou verificada.
 * O cliente já esperou confirmação antes de enviar o POST, por isso não há
 * fallback best-effort — uma tx não encontrada indica tentativa de fraude.
 */
async function verifyLikePayment({ tx, wallet, artistWallet, network }) {
  const apiKey = process.env.HELIUS_API_KEY;
  const cluster = network === 'mainnet-beta' ? 'mainnet' : 'devnet';
  const rpcUrl = apiKey
    ? `https://${cluster}.helius-rpc.com/?api-key=${apiKey}`
    : (cluster === 'mainnet' ? 'https://api.mainnet-beta.solana.com' : 'https://api.devnet.solana.com');

  let parsed;
  try {
    const r = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getTransaction',
        params: [tx, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }],
      }),
    });
    const json = await r.json();
    parsed = json?.result;
  } catch {
    return { ok: false, reason: 'Erro ao verificar pagamento. Tente novamente em instantes.' };
  }

  // Transação não encontrada = rejeitada. O cliente já confirmou antes de enviar.
  if (!parsed) {
    return { ok: false, reason: 'Transação não encontrada on-chain. Aguarde a confirmação e tente novamente.' };
  }

  if (parsed.meta?.err) return { ok: false, reason: 'Transação falhou on-chain.' };

  const priceLamports = Math.round(parseFloat(process.env.NEXT_PUBLIC_LIKE_PRICE_SOL || '0.0028') * 1e9);

  const msg = parsed.transaction?.message;
  const instructions = msg?.instructions || [];
  const accountKeys  = msg?.accountKeys  || [];
  const signer = accountKeys.find(k => k.signer)?.pubkey;
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
  try {
    return await handleLikes(req, res);
  } catch (err) {
    console.error('[/api/likes FATAL]', err?.message);
    return res.status(500).json({ error: 'Erro no servidor.' });
  }
}

async function handleLikes(req, res) {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) return res.status(500).json({ error: 'PINATA_JWT ausente no ambiente da função.' });

  if (req.method === 'GET') {
    const { postId, wallet } = req.query;

    if (postId && !SOLANA_ADDR_RE.test(postId)) {
      return res.status(400).json({ error: 'postId inválido.' });
    }
    if (wallet && !SOLANA_ADDR_RE.test(wallet)) {
      return res.status(400).json({ error: 'wallet inválida.' });
    }

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

      // Valida formatos Solana antes de qualquer operação
      if (!SOLANA_ADDR_RE.test(postId))      return res.status(400).json({ error: 'postId inválido.' });
      if (!SOLANA_ADDR_RE.test(wallet))      return res.status(400).json({ error: 'wallet inválida.' });
      if (!SOLANA_ADDR_RE.test(artistWallet)) return res.status(400).json({ error: 'artistWallet inválida.' });
      if (!SOLANA_TX_RE.test(tx))            return res.status(400).json({ error: 'Assinatura de transação inválida.' });

      if (wallet === artistWallet) {
        return res.status(403).json({ error: 'O artista não pode curtir o próprio post.' });
      }

      const network = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet';
      const { likes } = await getLatestLikes(jwt);
      const list = likes[postId] || [];

      if (list.some(l => l.wallet === wallet)) {
        return res.status(409).json({ error: 'Esta wallet já curtiu este post.' });
      }
      const txReused = Object.values(likes).some(arr => arr.some(l => l.tx === tx));
      if (txReused) {
        return res.status(409).json({ error: 'Esta transação já foi usada para registrar um like.' });
      }

      // Verificação on-chain obrigatória — sem fallback de aceitar pagamento não verificado
      const verification = await verifyLikePayment({ tx, wallet, artistWallet, network });
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

export const config = {
  maxDuration: 10,
};
