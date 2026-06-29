/**
 * pages/api/arts.js
 * Busca artes combinando:
 *  1. Registro próprio no Pinata (funciona na devnet, onde o Helius não indexa)
 *  2. Helius searchAssets (funciona na mainnet)
 * Faz merge dos dois e remove duplicatas.
 */

const REGISTRY_NAME = 'urban-secure-registry-v1';

async function getRegistry(jwt) {
  try {
    const r = await fetch(
      `https://api.pinata.cloud/data/pinList?status=pinned&metadata[name]=${REGISTRY_NAME}&pageLimit=1&sortBy=date_pinned&sortOrder=DESC`,
      { headers: { Authorization: `Bearer ${jwt}` } }
    );
    if (!r.ok) return [];
    const data = await r.json();
    const row = data?.rows?.[0];
    if (!row) return [];
    const g = await fetch(`https://gateway.pinata.cloud/ipfs/${row.ipfs_pin_hash}`);
    const arts = await g.json();
    return Array.isArray(arts) ? arts : [];
  } catch { return []; }
}

async function getHelius(apiKey, network) {
  const cluster = network === 'mainnet-beta' ? 'mainnet' : 'devnet';
  const url = `https://${cluster}.helius-rpc.com/?api-key=${apiKey}`;
  let page = 1, assets = [];
  try {
    while (page <= 10) {
      const r = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc:'2.0', id:'u', method:'searchAssets', params:{ tokenType:'nonFungible', page, limit:1000 } }),
      });
      if (!r.ok) break;
      const data = await r.json();
      const items = data?.result?.items ?? [];
      assets = [...assets, ...items];
      if (items.length < 1000) break;
      page++;
    }
  } catch {}
  return assets
    .filter(a => (a?.content?.metadata?.symbol ?? '').trim() === 'URBAN')
    .map(asset => {
      const attrs = asset?.content?.metadata?.attributes ?? [];
      const lat = parseFloat(attrs.find(x=>x.trait_type==='Latitude')?.value);
      const lng = parseFloat(attrs.find(x=>x.trait_type==='Longitude')?.value);
      if (isNaN(lat)||isNaN(lng)) return null;
      const artistName = attrs.find(x=>x.trait_type==='Artista')?.value || (asset?.content?.metadata?.name??'').replace('Urban Art — ','');
      return {
        id: asset.id, name: asset?.content?.metadata?.name ?? 'Urban Art', artistName,
        description: asset?.content?.metadata?.description ?? '',
        lat, lng, imageUrl: asset?.content?.links?.image ?? '',
        artistWallet: asset?.ownership?.owner ?? '', timestamp: Date.now(),
      };
    })
    .filter(Boolean);
}

export default async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey  = process.env.HELIUS_API_KEY;
  const jwt     = process.env.PINATA_JWT;
  const network = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet';

  try {
    // Busca as duas fontes em paralelo
    const [registry, helius] = await Promise.all([
      jwt ? getRegistry(jwt) : Promise.resolve([]),
      apiKey ? getHelius(apiKey, network) : Promise.resolve([]),
    ]);

    // Merge sem duplicatas (por id)
    const map = new Map();
    [...registry, ...helius].forEach(a => { if (a?.id) map.set(a.id, a); });
    const arts = Array.from(map.values()).filter(a => !isNaN(parseFloat(a.lat)) && !isNaN(parseFloat(a.lng)));

    res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=120');
    return res.status(200).json({ arts, total: arts.length });
  } catch (err) {
    console.error('[/api/arts]', err.message);
    return res.status(200).json({ arts: [], total: 0 });
  }
}
