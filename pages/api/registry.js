/**
 * pages/api/registry.js
 * Registro próprio de artes (contorna falta de indexação na devnet).
 * Usa Pinata pinList para achar o índice mais recente pelo nome.
 *
 * ?debug=1 no GET → mostra diagnóstico.
 */

const REGISTRY_NAME = 'urban-secure-registry-v1';

async function getLatestRegistry(jwt) {
  // pinList com filtro de metadata name (formato correto do Pinata)
  const q = `https://api.pinata.cloud/data/pinList?status=pinned&pageLimit=1&sortBy=date_pinned&sortOrder=DESC&metadata[name]=${encodeURIComponent(REGISTRY_NAME)}`;
  const r = await fetch(q, { headers: { Authorization: `Bearer ${jwt}` } });
  if (!r.ok) {
    const t = await r.text();
    return { cid: null, arts: [], _err: `pinList ${r.status}: ${t.slice(0,150)}` };
  }
  const data = await r.json();
  const row = data?.rows?.[0];
  if (!row) return { cid: null, arts: [], _empty: true };
  try {
    const g = await fetch(`https://gateway.pinata.cloud/ipfs/${row.ipfs_pin_hash}`);
    const arts = await g.json();
    return { cid: row.ipfs_pin_hash, arts: Array.isArray(arts) ? arts : [] };
  } catch (e) {
    return { cid: row.ipfs_pin_hash, arts: [], _err: 'gateway read fail' };
  }
}

export default async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const jwt = process.env.PINATA_JWT;
  if (!jwt) return res.status(500).json({ error: 'Servidor não configurado.' });

  if (req.method === 'GET') {
    const result = await getLatestRegistry(jwt);
    if (req.query?.debug === '1') return res.status(200).json(result);
    return res.status(200).json({ arts: result.arts, total: result.arts.length });
  }

  if (req.method === 'POST') {
    try {
      const art = req.body;
      if (!art?.id || isNaN(art.lat) || isNaN(art.lng)) {
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
        const t = await r.text();
        console.error('[registry POST]', r.status, t);
        return res.status(502).json({ error: `Pinata ${r.status}: ${t.slice(0,150)}` });
      }
      const out = await r.json();
      return res.status(200).json({ ok: true, total: arts.length, cid: out.IpfsHash });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
