/**
 * lib/stickers/album.js
 * Monta o álbum de figurinhas de uma carteira. Funções puras.
 *
 * MODELO DO ÁLBUM — o álbum é o acervo INTEIRO do projeto: cada arte
 * registrada ocupa um slot numerado, e o usuário coleciona as que ganhar.
 * Slot vazio = arte que existe no app e ele ainda não tem.
 *
 * Isso é o que faz "me falta a 12" significar a mesma coisa pra duas pessoas
 * — e é essa linguagem comum que torna a troca possível. Um álbum onde cada
 * um numera as próprias figurinhas não teria como sustentar troca nenhuma.
 *
 * COLAR vs TROCAR (resolve a tensão do requisito "não pode remover, mas pode
 * trocar"): funciona como álbum de figurinha de verdade.
 *   - figurinha nova cai no BOLSO, sem colar
 *   - slot vazio no álbum → dá pra COLAR, e colar é irreversível
 *   - slot já preenchido → a figurinha é REPETIDA, e repetida é o que se troca
 * Ou seja: nada sai do álbum depois de colado; o que circula na troca são as
 * repetidas. Os dois requisitos valem ao mesmo tempo, sem exceção.
 */

/**
 * @param {object} params
 * @param {string} params.wallet
 * @param {Array}  params.arts      registry completo (define os slots)
 * @param {Array}  params.stickers  todas as figurinhas mintadas
 * @returns {{
 *   slots: Array,        um por arte registrada, na ordem do álbum
 *   pocket: Array,       figurinhas não coladas (novas + repetidas)
 *   duplicates: Array,   repetidas — o que pode ir pra troca
 *   pastedCount: number,
 *   totalSlots: number,
 *   completion: number,  0..1
 * }}
 */
export function buildAlbum({ wallet, arts, stickers }) {
  const ordered = [...(arts || [])].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

  const mine = (stickers || []).filter(s => s?.owner === wallet);

  // Coladas, indexadas por arte — no máximo uma por slot, por definição.
  const pastedByArt = new Map();
  const pocket = [];

  for (const sticker of mine) {
    if (sticker.pasted) pastedByArt.set(sticker.artId, sticker);
    else pocket.push(sticker);
  }

  const slots = ordered.map((art, i) => {
    const pasted = pastedByArt.get(art.id) || null;
    return {
      albumNumber: i + 1,
      artId: art.id,
      art,
      sticker: pasted,
      filled: !!pasted,
      // Só é colável se o usuário tem a figurinha no bolso E o slot está
      // vazio. Com o slot cheio, a do bolso é repetida.
      canPaste: !pasted && pocket.some(s => s.artId === art.id),
    };
  });

  // Repetida = está no bolso e o slot correspondente já está preenchido.
  const duplicates = pocket.filter(s => pastedByArt.has(s.artId));

  const pastedCount = pastedByArt.size;
  const totalSlots = slots.length;

  return {
    slots,
    pocket,
    duplicates,
    pastedCount,
    totalSlots,
    completion: totalSlots > 0 ? pastedCount / totalSlots : 0,
  };
}

/**
 * Quantos pacotes o usuário ainda tem pra abrir.
 *
 * Deriva de `completedCycles` menos as figurinhas que ESTA carteira ganhou
 * por streak. Conta por `mintedFor` e não por `owner`: senão, trocar ou
 * transferir uma figurinha de streak faria o saldo de pacotes subir de novo,
 * e daria pra fabricar pacotes infinitos passando a mesma figurinha entre
 * duas carteiras.
 */
export function packsAvailable({ wallet, claimState, stickers }) {
  const earned = claimState?.completedCycles || 0;
  const opened = (stickers || []).filter(
    s => s?.mintedFor === wallet && s?.source === 'streak'
  ).length;
  return Math.max(0, earned - opened);
}

/** Slots que faltam — o que o usuário procura numa troca. */
export function missingSlots(album) {
  return album.slots.filter(s => !s.filled);
}
