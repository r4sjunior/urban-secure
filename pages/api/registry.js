/**
 * pages/api/registry.js
 * Registro próprio de artes (contorna falta de indexação na devnet).
 * GET  → lista as artes registradas
 * POST → adiciona uma arte ao índice
 */

const REGISTRY_NAME = 'urban-secure-registry-v1';

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
      const art = req.body;
      if (!art?.id || typeof art.lat !== 'number' || isNaN(art.lat) || typeof art.lng !== 'number' || isNaN(art.lng)) {
        return res.status(400).json({ error: 'Dados inválidos.' });
      }
      const { arts } = await getLatestRegistry(jwt);
      if (!arts.find(a => a.id === art.id)) arts.push(art);

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
