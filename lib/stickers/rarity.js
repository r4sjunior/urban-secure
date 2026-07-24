/**
 * lib/stickers/rarity.js
 * Sorteio da figurinha: qual raridade e qual arte ela estampa.
 * Funções puras — o `random` é injetável pra que o sorteio seja testável.
 *
 * DECISÃO DE DESIGN: a imagem da figurinha é a imagem da ARTE, sem moldura
 * embutida. A moldura, o brilho e o crédito ao artista são renderizados pelo
 * app em CSS (components/stickers/StickerCard.jsx).
 *
 * A alternativa seria compor a imagem final no servidor, mas isso exigiria
 * canvas nativo (@napi-rs/canvas ou sharp) numa função serverless — dezenas
 * de MB de dependência e um passo de renderização por figurinha, tudo pra
 * gravar no IPFS uma moldura que o app já sabe desenhar de graça. O custo não
 * se paga: o que precisa ser permanente é o CRÉDITO ao artista, e isso vai
 * nos atributos on-chain, não nos pixels.
 *
 * Trade-off aceito: numa carteira externa a figurinha aparece como a arte
 * pura. O nome do NFT ("Figurinha #12 — por Fulano") carrega o contexto.
 */

import { RARITIES, rollRarity } from '../config';

export { RARITIES, rollRarity };

export function rarityByKey(key) {
  return RARITIES.find(r => r.key === key) || RARITIES[0];
}

/**
 * Escolhe qual arte a figurinha vai estampar.
 *
 * O sorteio é PONDERADO PELO INVERSO da circulação: quanto menos figurinhas
 * uma arte já gerou, maior a chance de ser sorteada. Com sorteio uniforme,
 * as primeiras artes registradas apareceriam em quase todas as figurinhas —
 * elas estão no acervo desde o começo e acumulam sorteios enquanto as novas
 * entram com zero. O resultado seria um álbum onde 90% das figurinhas são
 * das mesmas cinco obras, e artistas novos nunca circulariam.
 *
 * @param {Array}  arts      registry (artes registradas)
 * @param {Array}  stickers  figurinhas já mintadas
 * @param {object} opts
 * @param {string} [opts.excludeWallet] evita sortear a arte do próprio
 *   usuário — ganhar figurinha da própria obra não tem graça nenhuma
 * @param {Function} [opts.random]
 * @returns {object|null} a arte sorteada
 */
export function pickArt(arts, stickers, { excludeWallet, random = Math.random } = {}) {
  const pool = (arts || []).filter(a => a?.id && a?.imageUrl);
  if (pool.length === 0) return null;

  // Quantas figurinhas cada arte já gerou.
  const circulation = new Map();
  for (const s of stickers || []) {
    if (s?.artId) circulation.set(s.artId, (circulation.get(s.artId) || 0) + 1);
  }

  // Preferimos não sortear a arte do próprio usuário, mas se ele for o único
  // artista do app essa exclusão esvaziaria o pool — aí vale mais entregar
  // uma figurinha da própria obra que não entregar nada.
  const candidates = excludeWallet
    ? (pool.filter(a => a.artistWallet !== excludeWallet).length > 0
        ? pool.filter(a => a.artistWallet !== excludeWallet)
        : pool)
    : pool;

  // Peso 1/(1+n): arte inédita pesa 1, com 1 figurinha pesa 0.5, com 3 pesa
  // 0.25. Decai rápido o bastante pra espalhar, sem zerar a chance de uma
  // arte popular reaparecer.
  const weights = candidates.map(a => 1 / (1 + (circulation.get(a.id) || 0)));
  const total = weights.reduce((sum, w) => sum + w, 0);

  let roll = random() * total;
  for (let i = 0; i < candidates.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

/**
 * Número da arte no álbum: sua posição no registry ordenado por data de
 * registro. Estável porque o registry é append-only — arte nova recebe
 * número maior e nenhuma numeração existente muda.
 *
 * É o que permite o álbum ter "buracos" visíveis: o slot 12 é sempre a
 * mesma obra pra todo mundo, então "me falta a 12" quer dizer a mesma coisa
 * entre dois usuários — que é o que torna a troca possível.
 */
export function albumNumberOf(art, arts) {
  const ordered = [...(arts || [])].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  const index = ordered.findIndex(a => a.id === art.id);
  return index >= 0 ? index + 1 : 0;
}
