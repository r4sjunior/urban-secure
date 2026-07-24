/**
 * lib/collections.js
 * Nomes das coleções persistidas via lib/pinataStore.js.
 *
 * Cada constante é o `metadata[name]` de um pin no Pinata — na prática, o
 * nome de uma "tabela". Ficam centralizados aqui por dois motivos: um typo
 * num nome de coleção não dá erro, só faz o app ler uma coleção vazia e
 * começar do zero silenciosamente; e o sufixo de versão precisa ser mudado
 * em conjunto quando o formato de um registro muda de forma incompatível.
 *
 * REGRA DE VERSÃO: mudou o shape de um registro de um jeito que o código
 * antigo não lê? Sobe o `-vN`. O pin antigo continua existindo (nada é
 * apagado no IPFS), então dá pra migrar ou fazer rollback.
 */

// ── Coleções já existentes (v2 do app) — não renomear, têm dados em produção
export const REGISTRY     = 'urban-secure-registry-v1';   // artes registradas
export const LIKES        = 'urban-secure-likes-v1';
export const COLLECTS     = 'urban-secure-collects-v1';
export const COMMENTS     = 'urban-secure-comments-v1';
export const OFFERS       = 'urban-secure-offers-v1';
export const LISTINGS     = 'urban-secure-listings-v1';

// ── Coleções novas do Urban Secure Social ──────────────────────────────────

/** Perfis. Formato: { [wallet]: Profile } — mapa, não array, porque toda
 *  leitura é "o perfil desta carteira" e varrer array a cada request não
 *  escala com o número de usuários. */
export const PROFILES = 'urban-secure-profiles-v1';

/** Estado de claim/streak. Formato: { [wallet]: ClaimState }. Mesma razão
 *  de ser mapa: o claim lê e escreve exatamente uma entrada. */
export const CLAIMS = 'urban-secure-claims-v1';

/** Contabilidade diária do faucet: { [YYYY-MM-DD]: lamportsPagos }.
 *  Separado de CLAIMS de propósito — o teto diário é global e precisa ser
 *  lido/escrito atomicamente numa coleção pequena, sem arrastar o estado
 *  de todos os usuários junto a cada claim. */
export const FAUCET_LEDGER = 'urban-secure-faucet-ledger-v1';

/** Figurinhas mintadas. Formato: array de Sticker. Array porque a consulta
 *  principal é "todas as figurinhas desta arte" e "todas desta carteira" —
 *  duas dimensões, nenhuma delas boa como chave única. */
export const STICKERS = 'urban-secure-stickers-v1';

/** Propostas de troca de figurinhas: array de TradeOffer. */
export const TRADES = 'urban-secure-trades-v1';

/** Resultado das premiações semanais já pagas: array de WeeklyPayout.
 *  É o registro de idempotência do cron — antes de pagar, ele confere se
 *  já existe payout pra semana em questão. Sem isso, um retry do cron
 *  (Vercel reexecuta em caso de timeout) pagaria o prêmio duas vezes. */
export const WEEKLY_PAYOUTS = 'urban-secure-weekly-payouts-v1';
