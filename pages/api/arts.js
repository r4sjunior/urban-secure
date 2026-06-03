/**
 * pages/api/arts.js
 * Busca global de NFTs URBAN via Helius DAS API.
 * HELIUS_API_KEY fica apenas no servidor.
 */

export default async function handler(req, res) {
  // Aceita GET e POST
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey  = process.env.HELIUS_API_KEY;
  const network = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet';

  console.log('[/api/arts] iniciando busca');
  console.log('[/api/arts] network:', network);
  console.log('[/api/arts] apiKey presente:', !!apiKey);

  if (!apiKey) {
    console.error('[/api/arts] HELIUS_API_KEY não configurada');
    return res.status(500).json({ error: 'HELIUS_API_KEY não configurada.' });
  }

  const cluster = network === 'mainnet-beta' ? 'mainnet' : 'devnet';
  const url     = `https://${cluster}.helius-rpc.com/?api-key=${apiKey}`;

  try {
    let page   = 1;
    let assets = [];

    while (true) {
      console.log(`[/api/arts] buscando página ${page}…`);

      const heliusRes = await fetch(url, {
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

      if (!heliusRes.ok) {
        const errText = await heliusRes.text();
        console.error('[/api/arts] Helius error:', heliusRes.status, errText);
        break;
      }

      const data  = await heliusRes.json();
      const items = data?.result?.items ?? [];

      console.log(`[/api/arts] página ${page}: ${items.length} itens`);
      assets = [...assets, ...items];

      if (items.length < 1000) break;
      page++;
    }

    console.log(`[/api/arts] total assets URBAN: ${assets.length}`);

    // Filtra e formata — só campos públicos necessários
    const arts = assets
      .map(asset => {
        const attrs = asset?.content?.metadata?.attributes ?? [];
        const lat   = parseFloat(attrs.find(a => a.trait_type === 'Latitude')?.value);
        const lng   = parseFloat(attrs.find(a => a.trait_type === 'Longitude')?.value);

        if (isNaN(lat) || isNaN(lng)) return null;

        return {
          id:           asset.id,
          name:         asset?.content?.metadata?.name        ?? 'Urban Art',
          description:  asset?.content?.metadata?.description ?? '',
          lat,
          lng,
          imageUrl:     asset?.content?.links?.image          ?? '',
          artistWallet: asset?.ownership?.owner               ?? '',
          timestamp:    Date.now(),
        };
      })
      .filter(Boolean);

    console.log(`[/api/arts] artes com GPS válido: ${arts.length}`);

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({ arts, total: arts.length });

  } catch (err) {
    console.error('[/api/arts] erro interno:', err.message);
    return res.status(500).json({ error: 'Erro ao buscar artes.' });
  }
}
