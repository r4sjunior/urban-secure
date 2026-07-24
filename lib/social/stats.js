/**
 * lib/social/stats.js
 * Cálculo das estatísticas do perfil. Função pura — recebe as coleções já
 * carregadas e devolve os números.
 *
 * As estatísticas são DERIVADAS a cada leitura, nunca persistidas. Contador
 * guardado é contador que sai de sincronia: bastaria uma escrita falhar no
 * meio pra "artes registradas" divergir do registry pra sempre, e não haveria
 * como saber qual dos dois está certo. Derivando, a resposta é sempre
 * consistente com a fonte da verdade por construção.
 *
 * O custo disso é varrer o registry a cada leitura de perfil. Com o volume
 * atual (centenas de artes) é irrelevante; se passar de dezenas de milhares,
 * a saída é um índice por carteira em cache, não persistir contador.
 */

import { currentWeek, rankArtists } from './weekly';

/**
 * @param {object} params
 * @param {string} params.wallet
 * @param {Array}  params.arts      registry completo
 * @param {Array}  params.stickers  figurinhas (pode ser [] enquanto a feature não existe)
 * @param {object} params.claimState estado de claim da carteira (pode ser null)
 * @param {number} [params.now]
 * @returns {import('../../types/social').ProfileStats}
 */
export function computeProfileStats({ wallet, arts, stickers, claimState, now = Date.now() }) {
  const week = currentWeek(now);
  const ranking = rankArtists(arts, week);

  const myRank = ranking.find(r => r.wallet === wallet);

  return {
    artsRegistered: (arts || []).filter(a => a?.artistWallet === wallet).length,

    // Posse de figurinha é decidida pela chain; este campo lê o cache local
    // (lib/collections.js § STICKERS) só pra não disparar uma chamada DAS a
    // cada abertura de perfil. Diverge por alguns segundos depois de uma
    // troca, e isso é aceitável num contador de exibição.
    stickersCollected: (stickers || []).filter(s => s?.owner === wallet).length,

    currentStreak: claimState?.currentStreak ?? 0,
    longestStreak: claimState?.longestStreak ?? 0,
    completedCycles: claimState?.completedCycles ?? 0,

    weeklyRank: myRank?.position ?? null,
    artsThisWeek: myRank?.artsCount ?? 0,
  };
}
