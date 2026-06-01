/**
 * pages/api/arts.js
 *
 * Endpoint servidor para buscar todas as artes.
 * HELIUS_API_KEY fica no servidor — nunca exposta no browser.
 */

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey  = process.env.HELIUS_API_KEY;
  const network = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet';

  if (!apiKey) {
    return res.status(500).json({ error: 'HELIUS_API_KEY não configurada.' });
  }

  const cluster = network === 'mainnet-beta' ? 'mainnet' : 'devnet';
  const url     = `https://${cluster}.helius-rpc.com/?api-key=${apiKey}`;

  try {
    let page   = 1;
    let assets = [];

    while (true) {
      const res2 = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id:      'urban-secure',
          method:  'searchAssets',
          params:  {
            tokenType: 'nonFungible',
            content:   { metadata: { symbol: 'URBAN' } },
            page,
            limit: 1000,
          },
        }),
      });

      if (!res2.ok) break;
      const data  = await res2.json();
      const items = data?.result?.items ?? [];
      assets = [...assets, ...items];
      if (items.length < 1000) break;
      page++;
    }

    // Filtra e formata — retorna apenas campos públicos necessários
    // Nunca expõe dados internos do Helius ou chaves
    const arts = assets
      .map(asset => {
        const attrs = asset?.content?.metadata?.attributes ?? [];
        const lat   = parseFloat(attrs.find(a => a.trait_type === 'Latitude')?.value);
        const lng   = parseFloat(attrs.find(a => a.trait_type === 'Longitude')?.value);
        if (isNaN(lat) || isNaN(lng)) return null;

        return {
          id:           asset.id,
          name:         asset?.content?.metadata?.name ?? 'Urban Art',
          description:  asset?.content?.metadata?.description ?? '',
          lat, lng,
          imageUrl:     asset?.content?.links?.image ?? '',
          artistWallet: asset?.ownership?.owner ?? '',
          timestamp:    Date.now(),
        };
      })
      .filter(Boolean);

    // Cache de 60s no Vercel Edge
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({ arts });

  } catch (err) {
    console.error('[/api/arts]', err.message);
    // Nunca expõe detalhes internos do erro para o cliente
    return res.status(500).json({ error: 'Erro ao buscar artes.' });
  }
}
