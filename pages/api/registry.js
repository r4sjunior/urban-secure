/**
 * pages/api/registry.js
 * Registro próprio de artes (contorna falta de indexação na devnet).
 * GET  → lista as artes registradas
 * POST → adiciona uma arte ao índice (valida formato e propriedade do NFT)
 */

const REGISTRY_NAME  = 'urban-secure-registry-v1';
const SOLANA_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// Remove caracteres que poderiam ser usados para injeção de HTML/scripts
function sanitize(val, maxLen) {
  if (typeof val !== 'string') return '';
  return val.replace(/[<>"'`\\]/g, '').trim().slice(0, maxLen);
}

async function getLatestRegistry(jwt) {
  try {
    const q = `https://api.pinata.cloud/data/pinList?status=pinned&pageLimit=1&sortBy=date_pinned&sortOrder=DESC&metadata[name]=${encodeURIComponent(REGISTRY_NAME)}`;
    const r = await fetch(q, { headers: { Authorization: `Bearer ${jwt}` } });
    if (!r.ok) return { cid: null, arts: [] };
    const data = await r.json();
    const row = data?.rows?.[0];
    if (!row) return { cid: null, arts: [] };
    const g = await fetch(`https://gateway.pinata.cloud/ipfs/${row.ipfs_pin_hash}`);
    const arts = await g.json();
    return { cid: row.ipfs_pin_hash, arts: Array.isArray(arts) ? arts : [] };
  } catch {
    return { cid: null, arts: [] };
  }
}

/**
 * Verifica via Helius DAS que o NFT pertence à wallet declarada.
 * Só usado em mainnet onde o DAS indexa os assets.
 */
async function verifyNftOwnership(mintId, ownerWallet) {
  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) return true; // sem chave, aceita (best-effort)
  try {
    const r = await fetch(`https://mainnet.helius-rpc.com/?api-key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAsset', params: { id: mintId } }),
    });
    if (!r.ok) return true; // falha de API — aceita
    const data = await r.json();
    const owner = data?.result?.ownership?.owner;
    // Se DAS não retornar owner, aceita (NFT pode não estar indexado ainda)
    if (!owner) return true;
    return owner === ownerWallet;
  } catch {
    return true; // falha de rede — aceita
  }
}

export default async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const jwt = process.env.PINATA_JWT;
  if (!jwt) return res.status(500).json({ error: 'Servidor não configurado.' });

  if (req.method === 'GET') {
    const { arts } = await getLatestRegistry(jwt);
    res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=120');
    return res.status(200).json({ arts, total: arts.length });
  }

  if (req.method === 'POST') {
    try {
      const body = req.body;

      // Valida formatos de endereço Solana
      if (!body?.id || !SOLANA_ADDR_RE.test(body.id)) {
        return res.status(400).json({ error: 'ID de mint inválido.' });
      }
      if (!body?.artistWallet || !SOLANA_ADDR_RE.test(body.artistWallet)) {
        return res.status(400).json({ error: 'Endereço de artista inválido.' });
      }

      // Valida coordenadas GPS com faixas realistas
      const lat = parseFloat(body.lat);
      const lng = parseFloat(body.lng);
      if (isNaN(lat) || lat < -90  || lat > 90)  return res.status(400).json({ error: 'Latitude inválida.' });
      if (isNaN(lng) || lng < -180 || lng > 180) return res.status(400).json({ error: 'Longitude inválida.' });

      // Valida URL da imagem: só aceita gateway oficial do Pinata
      const rawUrl = typeof body.imageUrl === 'string' ? body.imageUrl : '';
      const imageUrl = rawUrl.startsWith('https://gateway.pinata.cloud/ipfs/') ? rawUrl : '';

      // Constrói objeto sanitizado — nunca persiste campos extras do body
      const safeArt = {
        id:           body.id,
        name:         sanitize(body.name,        200),
        artistName:   sanitize(body.artistName,  100),
        description:  sanitize(body.description, 500),
        lat,
        lng,
        imageUrl,
        artistWallet: body.artistWallet,
        timestamp:    typeof body.timestamp === 'number' && body.timestamp > 0
                        ? body.timestamp
                        : Date.now(),
      };

      // Em mainnet, verifica que o NFT pertence à wallet declarada
      const network = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet';
      if (network === 'mainnet-beta') {
        const owned = await verifyNftOwnership(safeArt.id, safeArt.artistWallet);
        if (!owned) {
          return res.status(403).json({ error: 'NFT não encontrado ou não pertence a esta carteira.' });
        }
      }

      const { arts } = await getLatestRegistry(jwt);
      if (!arts.find(a => a.id === safeArt.id)) arts.push(safeArt);

      const r = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
        method: 'POST',
        headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinataMetadata: { name: REGISTRY_NAME }, pinataContent: arts }),
      });
      if (!r.ok) {
        console.error('[registry POST]', r.status);
        return res.status(502).json({ error: 'Falha ao registrar.' });
      }
      return res.status(200).json({ ok: true, total: arts.length });
    } catch (err) {
      console.error('[registry POST]', err.message);
      return res.status(500).json({ error: 'Erro ao registrar.' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
