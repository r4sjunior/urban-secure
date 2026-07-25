/**
 * lib/social/hasRegisteredArt.js
 * "Esta carteira já registrou alguma arte?"
 *
 * POR QUE ISTO NÃO É UMA LINHA DE CÓDIGO: a resposta tem várias fontes, e a
 * mais barata mente com frequência.
 *
 * 1. O índice no Pinata (REGISTRY) é gravado por um POST que acontece DEPOIS
 *    do mint, num try/catch que apenas loga a falha (pages/index.jsx). A arte
 *    vai para a chain e o índice pode não receber — por rede instável, por
 *    credencial vencida, por a aba ter sido fechada. Aí o índice diz "nunca
 *    registrou" sobre quem registrou.
 *
 * 2. A chain tem DOIS padrões de asset convivendo. As artes novas são
 *    Metaplex Core; as anteriores à migração são Token Metadata. Procurar só
 *    um deles recusa metade dos usuários — justamente os mais antigos, que
 *    são os que mais registraram.
 *
 * Consultar só o índice, ou só o Core, fazia a trava do primeiro claim
 * recusar usuários legítimos com uma mensagem que os culpava ("registre sua
 * primeira arte") por uma falha nossa.
 *
 * Ordem: índice primeiro (custo zero, já está em memória), chain só quando o
 * índice diz não. O caminho comum não paga nada.
 */

const URBAN_SYMBOL = 'URBAN';

/** Confere no índice — barato, mas com buracos conhecidos. */
export function hasArtInRegistry(arts, wallet) {
  return (Array.isArray(arts) ? arts : []).some(a => a?.artistWallet === wallet);
}

function rpcUrl() {
  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) return null;
  const network = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet';
  const cluster = network === 'mainnet-beta' ? 'mainnet' : 'devnet';
  return `https://${cluster}.helius-rpc.com/?api-key=${apiKey}`;
}

/** O JSON off-chain declara o símbolo do app. Só até achar UM — a pergunta é
 *  "existe alguma?", não "quantas?". */
async function algumJsonEhUrban(uris) {
  for (const uri of uris.slice(0, 12)) {
    try {
      const res = await fetch(uri);
      const json = await res.json();
      if ((json?.symbol || '').trim() === URBAN_SYMBOL) return true;
    } catch {
      // URI inacessível não decide nada — segue para o próximo.
    }
  }
  return false;
}

/** Artes registradas depois da migração. */
async function temAssetCore(umi, wallet) {
  const { fetchAssetsByOwner } = await import('@metaplex-foundation/mpl-core');
  const { publicKey } = await import('@metaplex-foundation/umi');

  const assets = await fetchAssetsByOwner(umi, publicKey(wallet), { skipDerivePlugins: true });
  if (assets.length === 0) return false;

  // O Core não guarda `symbol` on-chain, só `name` e `uri`.
  return algumJsonEhUrban(assets.map(a => a.uri));
}

/** Acervo anterior à migração — o `symbol` vem on-chain, sem precisar ler o
 *  JSON, o que torna esta checagem mais rápida e mais confiável. */
async function temAssetTokenMetadata(umi, wallet) {
  const { fetchAllDigitalAssetWithTokenByOwner } = await import('@metaplex-foundation/mpl-token-metadata');
  const { publicKey } = await import('@metaplex-foundation/umi');

  const assets = await fetchAllDigitalAssetWithTokenByOwner(umi, publicKey(wallet));
  return assets.some(a => (a?.metadata?.symbol || '').trim() === URBAN_SYMBOL);
}

/**
 * Confere na chain, nos dois padrões.
 *
 * Limite conhecido: quem mintou e depois TRANSFERIU todas as artes não é
 * encontrado. É aceitável — essa pessoa pagou o mint do próprio bolso, que é
 * o que a trava anti-sybil quer garantir, e o caso é raro o bastante para não
 * justificar varrer o histórico de transações.
 */
export async function hasArtOnChain(wallet) {
  const url = rpcUrl();
  if (!url) return false;

  try {
    const { createUmi } = await import('@metaplex-foundation/umi-bundle-defaults');
    const { mplCore } = await import('@metaplex-foundation/mpl-core');
    const { mplTokenMetadata } = await import('@metaplex-foundation/mpl-token-metadata');

    const umi = createUmi(url).use(mplCore()).use(mplTokenMetadata());

    // Uma segunda tentativa depois de uma pausa.
    //
    // `getProgramAccounts` não enxerga um asset recém-criado de imediato: em
    // teste na devnet, 2,5s após o mint a busca voltava vazia e 12s depois
    // encontrava. Sem esta tolerância, quem registra a primeira arte e vai
    // direto ao claim é recusado logo depois de ter registrado — a hora mais
    // frustrante possível.
    //
    // Só o primeiro claim de cada carteira passa por aqui.
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      if (tentativa > 0) await new Promise(r => setTimeout(r, 4000));

      // Os dois padrões em paralelo, e a falha de um não derruba o outro:
      // se o Core estiver indisponível, o acervo Token Metadata ainda vale
      // como prova — e vice-versa.
      const [core, legacy] = await Promise.allSettled([
        temAssetCore(umi, wallet),
        temAssetTokenMetadata(umi, wallet),
      ]);

      if (core.status === 'rejected') console.error('[hasArtOnChain] core:', core.reason?.message);
      if (legacy.status === 'rejected') console.error('[hasArtOnChain] token-metadata:', legacy.reason?.message);

      if (core.value === true || legacy.value === true) return true;
    }
    return false;
  } catch (err) {
    console.error('[hasArtOnChain]', err.message);
    // Na dúvida, NÃO barra. Recusar por falha de infraestrutura repete o erro
    // que esta função existe para corrigir: culpar o usuário por um problema
    // nosso. O teto diário do faucet continua limitando o prejuízo caso
    // alguém se aproveite da brecha.
    return true;
  }
}

/**
 * Resposta final, combinando as fontes.
 * @param {Array}  arts   registry já carregado
 * @param {string} wallet
 */
export async function hasRegisteredArt(arts, wallet) {
  if (hasArtInRegistry(arts, wallet)) return true;
  return hasArtOnChain(wallet);
}
