/**
 * lib/social/hasRegisteredArt.js
 * "Esta carteira já registrou alguma arte?"
 *
 * POR QUE ISTO NÃO É UMA LINHA DE CÓDIGO: a resposta tem duas fontes, e a
 * mais barata mente com frequência.
 *
 * O índice no Pinata (REGISTRY) é gravado por um POST que acontece DEPOIS do
 * mint, dentro de um try/catch que apenas loga a falha (pages/index.jsx). Ou
 * seja: a arte vai para a chain e o índice pode não receber — por rede
 * instável, por credencial vencida, por o usuário fechar a aba. Quando isso
 * acontece, o índice diz "nunca registrou" sobre alguém que registrou.
 *
 * Consultar só o índice fazia a trava do primeiro claim recusar usuários
 * legítimos com uma mensagem que os culpava ("registre sua primeira arte")
 * por uma falha nossa. A chain é a autoridade; o índice é só o atalho.
 *
 * Ordem: índice primeiro (custo zero, já está em memória), chain só quando
 * o índice diz não. Assim o caminho comum não paga nada e o caso raro é
 * decidido corretamente.
 */

const URBAN_SYMBOL = 'URBAN';

/** Confere no índice — barato, mas pode ter buracos. */
export function hasArtInRegistry(arts, wallet) {
  return (Array.isArray(arts) ? arts : []).some(a => a?.artistWallet === wallet);
}

/**
 * Confere na chain se a carteira possui algum asset do app.
 *
 * Usa a busca por owner do Metaplex Core (getProgramAccounts), que funciona
 * em devnet — o indexador DAS do Helius não cobre a devnet por completo, e
 * depender dele faria a verificação falhar justamente na rede em que o app
 * roda hoje.
 *
 * Limite conhecido: quem mintou e depois TRANSFERIU todas as artes não é
 * encontrado. É aceitável — essa pessoa pagou o mint do próprio bolso, que é
 * o que a trava anti-sybil quer garantir, e o caso é raro o bastante para não
 * justificar varrer o histórico de transações.
 *
 * @returns {Promise<boolean>}
 */
export async function hasArtOnChain(wallet) {
  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) return false;

  const network = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet';
  const cluster = network === 'mainnet-beta' ? 'mainnet' : 'devnet';
  const rpcUrl = `https://${cluster}.helius-rpc.com/?api-key=${apiKey}`;

  try {
    const { createUmi } = await import('@metaplex-foundation/umi-bundle-defaults');
    const { mplCore, fetchAssetsByOwner } = await import('@metaplex-foundation/mpl-core');
    const { publicKey } = await import('@metaplex-foundation/umi');

    const umi = createUmi(rpcUrl).use(mplCore());
    const assets = await fetchAssetsByOwner(umi, publicKey(wallet), { skipDerivePlugins: true });

    if (assets.length === 0) return false;

    // O Core não guarda `symbol` on-chain, só `name` e `uri`. Para saber se o
    // asset é do app é preciso ler o JSON — mas só até achar UM, porque a
    // pergunta é "existe alguma?", não "quantas?".
    for (const asset of assets.slice(0, 12)) {
      try {
        const res = await fetch(asset.uri);
        const json = await res.json();
        if ((json?.symbol || '').trim() === URBAN_SYMBOL) return true;
      } catch {
        // JSON inacessível não decide nada — segue para o próximo.
      }
    }
    return false;
  } catch (err) {
    console.error('[hasArtOnChain]', err.message);
    // Na dúvida, NÃO barra. Recusar por falha de infraestrutura repete o
    // erro que esta função existe para corrigir: culpar o usuário por um
    // problema nosso. O teto diário do faucet continua limitando o prejuízo
    // caso alguém se aproveite da brecha.
    return true;
  }
}

/**
 * Resposta final, combinando as duas fontes.
 * @param {Array}  arts   registry já carregado
 * @param {string} wallet
 */
export async function hasRegisteredArt(arts, wallet) {
  if (hasArtInRegistry(arts, wallet)) return true;
  return hasArtOnChain(wallet);
}
