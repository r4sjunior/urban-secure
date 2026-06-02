/**
 * pages/api/arts.js
 * Busca global de NFTs URBAN via Helius DAS API.
 * Funciona SEM carteira conectada — busca server-side.
 * HELIUS_API_KEY nunca exposta ao browser.
 */

export default async function handler(req, res) {
  // ── Headers de segurança ──────────────────────────────────
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey  = process.env.HELIUS_API_KEY;
  const network = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet';

  if (!apiKey) {
    console.error('[/api/arts] HELIUS_API_KEY ausente');
    // Nunca expõe detalhes internos ao cliente
    return res.status(200).json({ arts: [], total: 0 });
  }

  const cluster = network === 'mainnet-beta' ? 'mainnet' : 'devnet';
  const url     = `https://${cluster}.helius-rpc.com/?api-key=${apiKey}`;

  try {
    let page   = 1;
    let assets = [];

    while (page <= 5) { // máx 5000 NFTs — proteção contra loop infinito
      const heliusRes = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id:      'urban-secure',
          method:  'searchAssets',
          params:  {
            tokenType: 'nonFungible',
            page,
            limit: 1000,
          },
        }),
      });

      if (!heliusRes.ok) {
        console.error('[/api/arts] Helius status:', heliusRes.status);
        break;
      }

      const data  = await heliusRes.json();
      const items = data?.result?.items ?? [];
      assets = [...assets, ...items];

      if (items.length < 1000) break;
      page++;
    }

    // Filtra: só NFTs com símbolo URBAN E coordenadas GPS válidas
    const arts = assets
      .filter(a => (a?.content?.metadata?.symbol ?? '').trim() === 'URBAN')
      .map(asset => {
        const attrs = asset?.content?.metadata?.attributes ?? [];
        const lat   = parseFloat(attrs.find(x => x.trait_type === 'Latitude')?.value);
        const lng   = parseFloat(attrs.find(x => x.trait_type === 'Longitude')?.value);
        if (isNaN(lat) || isNaN(lng)) return null;

        // Extrai nome do artista do atributo ou do nome do NFT
        const artistName = attrs.find(x => x.trait_type === 'Artista')?.value
          || (asset?.content?.metadata?.name ?? '').replace('Urban Art — ', '');

        return {
          id:           asset.id,
          name:         asset?.content?.metadata?.name        ?? 'Urban Art',
          artistName,
          description:  asset?.content?.metadata?.description ?? '',
          lat,
          lng,
          imageUrl:     asset?.content?.links?.image          ?? '',
          artistWallet: asset?.ownership?.owner               ?? '',
          timestamp:    Date.now(),
        };
      })
      .filter(Boolean);

    // Cache de 30s no Edge da Vercel
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=300');
    return res.status(200).json({ arts, total: arts.length });

  } catch (err) {
    console.error('[/api/arts] erro:', err.message);
    // Resposta genérica — não vaza stack trace
    return res.status(200).json({ arts: [], total: 0 });
  }
}
