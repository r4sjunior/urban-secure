/**
 * lib/solana/standard.js
 * Descobre se um mint é Metaplex Core ou Token Metadata.
 *
 * A migração pro Core (ver ARCHITECTURE.md § Padrão de NFT) vale só pros
 * mints NOVOS. Todo o acervo já registrado — artes, edições coletadas, obras
 * anunciadas na vault — é Token Metadata e precisa continuar transferível,
 * colecionável e visível no mapa. Um app que só entende o padrão novo
 * quebraria o histórico dos usuários, o que é inaceitável num produto cujo
 * valor é justamente o registro permanente.
 *
 * Então toda operação sobre um mint existente passa por aqui primeiro e é
 * roteada pro programa certo.
 */

/** Programa dono das contas de asset do Metaplex Core. */
export const MPL_CORE_PROGRAM = 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d';

/** Programas donos de um mint account SPL (Token Metadata usa um destes). */
const TOKEN_PROGRAMS = new Set([
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',   // SPL Token
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',   // Token-2022
]);

export const STANDARD_CORE = 'core';
export const STANDARD_TOKEN_METADATA = 'token-metadata';

/**
 * Detecta o padrão pelo DONO da conta.
 *
 * Um asset Core é uma conta única cujo owner é o programa Core. Um NFT Token
 * Metadata é um mint account cujo owner é o SPL Token Program. Olhar o owner
 * resolve numa chamada RPC e sem heurística — melhor do que tentar
 * `fetchAsset` e usar a exceção como resposta, que confundiria "não é Core"
 * com "RPC fora do ar".
 *
 * @param {string} rpcUrl
 * @param {string} mint
 * @returns {Promise<'core'|'token-metadata'|null>} null se a conta não existe
 */
export async function detectStandard(rpcUrl, mint) {
  const r = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'getAccountInfo',
      params: [mint, { encoding: 'base64', commitment: 'confirmed' }],
    }),
  });

  const json = await r.json();
  const owner = json?.result?.value?.owner;
  if (!owner) return null;

  if (owner === MPL_CORE_PROGRAM) return STANDARD_CORE;
  if (TOKEN_PROGRAMS.has(owner)) return STANDARD_TOKEN_METADATA;

  return null;
}

/**
 * Normaliza um asset do DAS (Helius) pro formato de arte do app,
 * independente do padrão em que foi mintado.
 *
 * O DAS descreve Core e Token Metadata com formas diferentes — o campo
 * `interface` vira "MplCoreAsset" em vez de "V1_NFT", e os atributos ficam
 * no mesmo lugar mas o dono é lido de outro caminho. Concentrar essa
 * diferença aqui evita que cada consumidor do DAS tenha que saber dos dois.
 */
export function normalizeDasAsset(asset) {
  const metadata = asset?.content?.metadata;
  if (!metadata) return null;

  const attrs = metadata.attributes ?? [];
  const attr = (name) => attrs.find(x => x.trait_type === name)?.value;

  const lat = parseFloat(attr('Latitude'));
  const lng = parseFloat(attr('Longitude'));
  if (isNaN(lat) || isNaN(lng)) return null;

  const name = metadata.name ?? 'Urban Art';

  return {
    id: asset.id,
    name,
    artistName: attr('Artista') || name.replace('Urban Art — ', ''),
    description: metadata.description ?? '',
    lat,
    lng,
    imageUrl: asset?.content?.links?.image ?? '',
    artistWallet: asset?.ownership?.owner ?? '',
    standard: asset?.interface === 'MplCoreAsset' ? STANDARD_CORE : STANDARD_TOKEN_METADATA,
    timestamp: Date.now(),
  };
}

/** Um asset do app? Vale pros dois padrões — o símbolo URBAN está no
 *  metadata JSON off-chain, que o DAS lê igual nos dois casos. */
export function isUrbanAsset(asset) {
  if ((asset?.content?.metadata?.symbol ?? '').trim() !== 'URBAN') return false;

  // Descarta assets de TESTE e registros quebrados.
  //
  // Durante o desenvolvimento foram mintados assets com URI de placeholder
  // (`.../QmTest`), que não resolve em imagem nenhuma. Eles apareciam no app
  // como retângulos pretos — sem foto, sem contexto, ocupando espaço no mapa
  // e no álbum como se fossem obra de alguém.
  //
  // O filtro é por CONTEÚDO, não por lista de endereços: qualquer registro
  // sem imagem utilizável é ruído, venha de teste ou de um upload que falhou
  // no meio. Uma lista de mints a bloquear só cobriria os que já conhecemos.
  const uri = asset?.content?.json_uri ?? '';
  const image = asset?.content?.links?.image ?? '';
  const name = asset?.content?.metadata?.name ?? '';

  if (/QmTest|placeholder|example\.com/i.test(uri)) return false;
  if (!image || !image.startsWith('https://')) return false;
  if (/^Urban Art — Teste/i.test(name)) return false;

  return true;
}
