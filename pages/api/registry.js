/**
 * pages/api/registry.js
 * Registro próprio de artes mintadas (contorna falta de indexação na devnet).
 *
 * GET  → retorna a lista de mints registrados (lê do Pinata)
 * POST → adiciona um novo mint { address, name, artistName, description, lat, lng, imageUrl, artistWallet }
 *
 * Usa Pinata: mantém um JSON com metadata name "urban-secure-registry"
 * e sempre busca a versão mais recente por esse nome.
 */

const REGISTRY_NAME = 'urban-secure-registry-v1';

async function getLatestRegistry(jwt) {
  // Busca o pin mais recente com o nome do registro
  const r = await fetch(
    `https://api.pinata.cloud/data/pinList?status=pinned&metadata[name]=${REGISTRY_NAME}&pageLimit=1&sortBy=date_pinned&sortOrder=DESC`,
    { headers: { Authorization: `Bearer ${jwt}` } }
  );
  if (!r.ok) return { cid: null, arts: [] };
  const data = await r.json();
  const row = data?.rows?.[0];
  if (!row) return { cid: null, arts: [] };

  // Lê o conteúdo do JSON via gateway
  try {
    const g = await fetch(`https://gateway.pinata.cloud/ipfs/${row.ipfs_pin_hash}`);
    const arts = await g.json();
    return { cid: row.ipfs_pin_hash, arts: Array.isArray(arts) ? arts : [] };
  } catch {
    return { cid: row.ipfs_pin_hash, arts: [] };
  }
}

export default async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const jwt = process.env.PINATA_JWT;
  if (!jwt) return res.status(500).json({ error: 'Servidor não configurado.' });

  // ── GET: lista artes registradas ──
  if (req.method === 'GET') {
    try {
      const { arts } = await getLatestRegistry(jwt);
      res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=120');
      return res.status(200).json({ arts, total: arts.length });
    } catch (err) {
      console.error('[registry GET]', err.message);
      return res.status(200).json({ arts: [], total: 0 });
    }
  }

  // ── POST: adiciona uma arte ──
  if (req.method === 'POST') {
    try {
      const art = req.body;
      if (!art?.id || isNaN(art.lat) || isNaN(art.lng)) {
        return res.status(400).json({ error: 'Dados inválidos.' });
      }

      const { arts } = await getLatestRegistry(jwt);
      // Evita duplicatas
      if (!arts.find(a => a.id === art.id)) arts.push(art);

      // Salva a nova versão no Pinata
      const r = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
        method: 'POST',
        headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pinataMetadata: { name: REGISTRY_NAME },
          pinataContent: arts,
        }),
      });
      if (!r.ok) {
        const t = await r.text();
        console.error('[registry POST] pinata', r.status, t);
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
