/**
 * pages/api/arts.js
 * Busca global de NFTs URBAN via Helius.
 * ?debug=1 → mostra diagnóstico do que o Helius retornou.
 */

export default async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey  = process.env.HELIUS_API_KEY;
  const network = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet';
  const debug   = req.query?.debug === '1';

  if (!apiKey) return res.status(200).json({ arts: [], total: 0, _err: 'no_api_key' });

  const cluster = network === 'mainnet-beta' ? 'mainnet' : 'devnet';
  const url     = `https://${cluster}.helius-rpc.com/?api-key=${apiKey}`;

  try {
    let page = 1, assets = [];
    while (page <= 10) {
      const heliusRes = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id:      'urban-secure',
          method:  'searchAssets',
          params:  { tokenType: 'nonFungible', page, limit: 1000 },
        }),
      });
      if (!heliusRes.ok) {
        const t = await heliusRes.text();
        if (debug) return res.status(200).json({ arts: [], total: 0, _heliusStatus: heliusRes.status, _heliusErr: t.slice(0,300), network, cluster });
        break;
      }
      const data  = await heliusRes.json();
      const items = data?.result?.items ?? [];
      assets = [...assets, ...items];
      if (items.length < 1000) break;
      page++;
    }

    // DEBUG: mostra os symbols encontrados
    if (debug) {
      const symbols = assets.map(a => ({
        symbol: a?.content?.metadata?.symbol ?? '(vazio)',
        name:   a?.content?.metadata?.name ?? '(sem nome)',
        hasAttrs: (a?.content?.metadata?.attributes ?? []).length,
      }));
      return res.status(200).json({
        network, cluster,
        totalNFTs: assets.length,
        symbols: symbols.slice(0, 20),
      });
    }

    const arts = assets
      .filter(a => (a?.content?.metadata?.symbol ?? '').trim() === 'URBAN')
      .map(asset => {
        const attrs = asset?.content?.metadata?.attributes ?? [];
        const lat   = parseFloat(attrs.find(x => x.trait_type === 'Latitude')?.value);
        const lng   = parseFloat(attrs.find(x => x.trait_type === 'Longitude')?.value);
        if (isNaN(lat) || isNaN(lng)) return null;
        const artistName = attrs.find(x => x.trait_type === 'Artista')?.value
          || (asset?.content?.metadata?.name ?? '').replace('Urban Art — ', '');
        return {
          id: asset.id,
          name: asset?.content?.metadata?.name ?? 'Urban Art',
          artistName,
          description: asset?.content?.metadata?.description ?? '',
          lat, lng,
          imageUrl: asset?.content?.links?.image ?? '',
          artistWallet: asset?.ownership?.owner ?? '',
          timestamp: Date.now(),
        };
      })
      .filter(Boolean);

    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=300');
    return res.status(200).json({ arts, total: arts.length });
  } catch (err) {
    console.error('[/api/arts]', err.message);
    return res.status(200).json({ arts: [], total: 0, _err: err.message });
  }
}
