/**
 * pages/api/arts.js
 * Busca artes combinando:
 *  1. Registro próprio no Pinata (funciona na devnet, onde o Helius não indexa)
 *  2. Helius searchAssets (funciona na mainnet)
 * Faz merge dos dois e remove duplicatas.
 */

import { isUrbanAsset, normalizeDasAsset } from '../../lib/solana/standard';
import { getLatestPin } from '../../lib/pinataStore';

const REGISTRY_NAME = 'urban-secure-registry-v1';

async function getRegistry(jwt) {
  // Usa lib/pinataStore, que corre entre vários gateways IPFS. A leitura
  // direta pelo gateway do Pinata levava ~3,8s e atrasava o mapa inteiro.
  try {
    const arts = await getLatestPin(jwt, REGISTRY_NAME, []);
    return Array.isArray(arts) ? arts : [];
  } catch { return []; }
}

/**
 * Busca no DAS os dois padrões de asset do app.
 *
 * `tokenType: 'nonFungible'` cobre o acervo Token Metadata, mas NÃO retorna
 * assets Metaplex Core — o DAS os classifica como interface "MplCoreAsset" e
 * eles ficam de fora desse filtro. Depois da migração (ver ARCHITECTURE.md),
 * consultar só uma das duas formas deixaria metade do mapa invisível: as
 * artes novas ou as antigas, dependendo do filtro escolhido.
 */
async function getHelius(apiKey, network) {
  const cluster = network === 'mainnet-beta' ? 'mainnet' : 'devnet';
  const url = `https://${cluster}.helius-rpc.com/?api-key=${apiKey}`;

  async function search(params) {
    let page = 1, assets = [];
    try {
      while (page <= 10) {
        const r = await fetch(url, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 'u', method: 'searchAssets', params: { ...params, page, limit: 1000 } }),
        });
        if (!r.ok) break;
        const data = await r.json();
        const items = data?.result?.items ?? [];
        assets = [...assets, ...items];
        if (items.length < 1000) break;
        page++;
      }
    } catch {}
    return assets;
  }

  // As duas buscas em paralelo — são independentes e cada uma pode paginar.
  const [legacy, core] = await Promise.all([
    search({ tokenType: 'nonFungible' }),
    search({ interface: 'MplCoreAsset' }),
  ]);

  return [...legacy, ...core]
    .filter(isUrbanAsset)
    .map(normalizeDasAsset)
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
    // Além das coordenadas, exige imagem utilizável: registros sem imagem
    // (upload que falhou, asset de teste) apareciam como retângulos pretos
    // no mapa e no feed.
    const arts = Array.from(map.values()).filter(a =>
      !isNaN(parseFloat(a.lat)) &&
      !isNaN(parseFloat(a.lng)) &&
      typeof a.imageUrl === 'string' &&
      a.imageUrl.startsWith('https://') &&
      !/QmTest|placeholder/i.test(a.imageUrl)
    );

    res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=120');
    return res.status(200).json({ arts, total: arts.length });
  } catch (err) {
    console.error('[/api/arts]', err.message);
    return res.status(200).json({ arts: [], total: 0 });
  }
}
