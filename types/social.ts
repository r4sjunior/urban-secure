/**
 * types/social.ts
 * Shapes dos registros do Urban Secure Social.
 *
 * Estes tipos são propositalmente modelados como CONTAS de um programa
 * Anchor, não como linhas de um banco: chave derivável a partir da carteira,
 * campos de tamanho fixo, sem estruturas aninhadas de tamanho livre. Hoje
 * eles são persistidos off-chain via lib/pinataStore.js, mas na Fase 2 (ver
 * ARCHITECTURE.md) viram PDAs do programa `urban_social`. Manter o shape já
 * compatível faz dessa migração uma troca de camada de acesso, não uma
 * reescrita do app inteiro.
 *
 * Por isso: nada de campos derivados persistidos (contadores que dá pra
 * calcular), nada de arrays sem limite superior dentro de um registro.
 */

/** Endereço Solana em base58. */
export type Wallet = string;

/** Milissegundos desde a época Unix (Date.now()). */
export type Timestamp = number;

// ── Perfil ─────────────────────────────────────────────────────────────────

export type SocialPlatform = 'instagram' | 'x' | 'tiktok' | 'farcaster';

/** Guardamos só o handle, nunca a URL completa: o app monta a URL a partir
 *  do baseUrl em lib/config.js. Isso impede que o campo de perfil vire um
 *  vetor pra apontar link a qualquer lugar. */
export type SocialLinks = Partial<Record<SocialPlatform, string>>;

export interface Profile {
  /** PDA seed na Fase 2: ["profile", wallet]. */
  wallet: Wallet;
  /** Nome de exibição. Não é único e não é identidade — a carteira é. */
  handle: string;
  /** Máx. 160 caracteres (BIO_MAX_LENGTH). */
  bio: string;
  /** URL da foto no gateway do Pinata. Vazio = usa avatar gerado da carteira. */
  avatarUrl: string;
  socials: SocialLinks;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** Estatísticas do perfil. NÃO é persistido: é calculado sob demanda a
 *  partir do registry, das figurinhas e do estado de claim. Contador
 *  persistido é contador que sai de sincronia — a fonte da verdade é sempre
 *  a coleção original. */
export interface ProfileStats {
  artsRegistered: number;
  stickersCollected: number;
  currentStreak: number;
  longestStreak: number;
  /** Posição no ranking da semana corrente, ou null se não pontuou. */
  weeklyRank: number | null;
  artsThisWeek: number;
}

// ── Claim / streak ─────────────────────────────────────────────────────────

export interface ClaimState {
  /** PDA seed na Fase 2: ["claim", wallet]. */
  wallet: Wallet;
  /** Quando o último claim foi confirmado on-chain. */
  lastClaimAt: Timestamp;
  /** Dias consecutivos. Zera se passar STREAK_GRACE_MS sem claimar. */
  currentStreak: number;
  longestStreak: number;
  /** Ciclos de 7 dias já fechados. É o que libera a troca de figurinhas
   *  (>= 1) — por isso é contador acumulado, não flag booleana. */
  completedCycles: number;
  totalClaims: number;
  /** Lamports recebidos no total. Só pra exibição e auditoria. */
  totalLamportsClaimed: number;
  /** Assinatura da última transferência. Serve de trava de idempotência:
   *  se o servidor cair depois de transferir mas antes de gravar o estado,
   *  o retry encontra a assinatura já registrada e não paga de novo. */
  lastSignature: string;
}

// ── Figurinhas ─────────────────────────────────────────────────────────────

export type RarityKey = 'comum' | 'raro' | 'epico' | 'lendario';

export interface Sticker {
  /** Endereço do mint NFT. É a identidade da figurinha. */
  mint: string;
  /** Carteira que possui a figurinha no momento do registro. A verdade sobre
   *  posse é sempre a chain (DAS getAssetsByOwner) — este campo é cache pra
   *  montar o álbum sem uma chamada RPC por figurinha. */
  owner: Wallet;
  /** Mint da arte original que a figurinha estampa. */
  artId: string;
  /** Nome do artista que registrou a arte original — crédito obrigatório na
   *  face da figurinha. */
  artistName: string;
  artistWallet: Wallet;
  imageUrl: string;
  rarity: RarityKey;
  /** Número da figurinha no álbum, sequencial e estável. É o que permite
   *  layout de álbum com espaços vazios ("faltam a 12 e a 47"). */
  albumNumber: number;
  /** Como a figurinha entrou em circulação. */
  source: 'streak' | 'evento' | 'troca';
  mintedAt: Timestamp;
  /** Assinatura do mint — auditoria. */
  signature: string;
}

/** Uma figurinha "colada" no álbum. Colar é irreversível por design (a
 *  espec. diz que não dá pra descolar), então isto é append-only. */
export interface AlbumSlot {
  albumNumber: number;
  mint: string;
  pastedAt: Timestamp;
}

// ── Troca ──────────────────────────────────────────────────────────────────

export type TradeStatus = 'pendente' | 'aceita' | 'recusada' | 'cancelada' | 'expirada';

export interface TradeOffer {
  id: string;
  fromWallet: Wallet;
  toWallet: Wallet;
  /** Mint que quem propõe está oferecendo. */
  offeredMint: string;
  /** Mint que quem propõe quer receber. */
  requestedMint: string;
  status: TradeStatus;
  createdAt: Timestamp;
  /** Propostas expiram — senão o álbum enche de oferta morta sobre
   *  figurinha que o dono já trocou com outra pessoa. */
  expiresAt: Timestamp;
  resolvedAt?: Timestamp;
  /** Assinaturas das duas transferências, quando aceita. */
  signatures?: [string, string];
}

// ── Ranking semanal ────────────────────────────────────────────────────────

export interface WeeklyRankEntry {
  wallet: Wallet;
  handle: string;
  avatarUrl: string;
  artsCount: number;
  position: number;
}

export interface WeeklyPayout {
  /** Semana ISO no formato "2026-W31". Chave de idempotência do cron de
   *  premiação: com payout já gravado pra esta semana, o cron não paga
   *  de novo mesmo se for reexecutado. */
  week: string;
  paidAt: Timestamp;
  winners: Array<{
    wallet: Wallet;
    position: number;
    artsCount: number;
    lamports: number;
    signature: string;
  }>;
}
