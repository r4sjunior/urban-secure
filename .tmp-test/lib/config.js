/**
 * lib/config.js
 * Parâmetros econômicos e de gameplay do Urban Secure Social, num lugar só.
 *
 * Tudo que é "quanto custa" ou "quanto paga" mora aqui, porque esses números
 * se equilibram entre si: o claim diário precisa cobrir N registros de arte,
 * e o prêmio semanal precisa caber no que a treasury recebe. Espalhar isso
 * pelo código faz o balanceamento sair do lugar sem ninguém perceber.
 *
 * Os valores aceitam override por env var pra dar pra ajustar em produção
 * sem redeploy de código — mas todo default aqui é o valor de referência.
 */

export const LAMPORTS_PER_SOL = 1_000_000_000;

function envFloat(name, fallback) {
  const raw = process.env[name];
  const n = parseFloat(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// ── Custo de registrar uma arte ────────────────────────────────────────────
// MEDIDO na devnet em 2026-07-24, mintando um asset Core de verdade:
// rent 0.00332352 (conta de 134 bytes) + fee 0.0000506 = 0.00337412 SOL.
//
// O valor aqui é 0.0035 — arredondado PRA CIMA de propósito. Este número
// multiplica ARTS_PER_CLAIM pra formar o claim diário, e a promessa ao
// usuário é "dá pra registrar 3 artes". Orçar por baixo (a estimativa
// original era 0.0029, tirada da documentação) faria o claim cobrir 2.58
// mints: o usuário registraria duas artes, tentaria a terceira e tomaria
// erro de saldo — quebrando a promessa sem que nada estivesse "com bug".
// A folga também absorve variação da priority fee em rede congestionada.
//
// O Token Metadata anterior custava ~0.0115 SOL (4 contas: mint + ATA +
// metadata + master edition). A migração pro Core cortou 70%.
export const ART_MINT_COST_SOL = envFloat('NEXT_PUBLIC_ART_MINT_COST_SOL', 0.0035);

// ── Claim diário ───────────────────────────────────────────────────────────
// A promessa ao usuário é "dá pra registrar 3 artes por dia". Derivamos do
// custo real do mint em vez de fixar um número solto, pra promessa continuar
// verdadeira se o custo mudar (ex.: migração pro Core).
export const ARTS_PER_CLAIM = 3;
export const DAILY_CLAIM_SOL = Number((ART_MINT_COST_SOL * ARTS_PER_CLAIM).toFixed(6));

// ── Claim de boas-vindas ───────────────────────────────────────────────────
// O claim diário exige uma arte registrada (trava anti-sybil), mas registrar
// uma arte custa SOL. Sem isto, quem chega com a carteira vazia fica preso
// num impasse: não pode registrar porque não tem SOL, e não recebe SOL
// porque não registrou.
//
// O claim de boas-vindas quebra o ciclo — uma vez por carteira, cobrindo o
// mint de UMA arte com folga para a taxa de rede. É liberado só depois de
// completar o cadastro do perfil: preencher nome e bio é um custo pequeno
// para quem é real e um atrito relevante para quem automatiza mil contas.
export const WELCOME_CLAIM_SOL = Number((ART_MINT_COST_SOL * 1.6).toFixed(6));

// Janela do claim: 20h em vez de 24h. Com 24h cravadas, quem claima às 9h
// hoje só pode claimar às 9h01 amanhã — atrasa alguns minutos por dia e em
// uma semana o horário já andou, o que quebra streak de gente que não fez
// nada de errado. 20h dá folga pro usuário claimar "no mesmo horário" todo
// dia sem risco.
export const CLAIM_COOLDOWN_MS = 20 * 60 * 60 * 1000;

// Prazo pra manter o streak: se passar disso sem claimar, o contador zera.
// 48h = o usuário pode pular um dia de calendário e ainda assim continuar,
// desde que volte em até dois dias.
export const STREAK_GRACE_MS = 48 * 60 * 60 * 1000;

// ── Streak ─────────────────────────────────────────────────────────────────
export const STREAK_TARGET = 7;          // dias pra fechar um ciclo
export const STREAK_BONUS_MULTIPLIER = 2; // multiplicador do claim no 7º dia

/** Quanto vale o claim do dia `streakDay` (1-based) em lamports. */
export function claimAmountLamports(streakDay) {
  const base = DAILY_CLAIM_SOL;
  const isBonusDay = streakDay > 0 && streakDay % STREAK_TARGET === 0;
  const sol = isBonusDay ? base * STREAK_BONUS_MULTIPLIER : base;
  return Math.round(sol * LAMPORTS_PER_SOL);
}

// ── Ranking semanal ────────────────────────────────────────────────────────
// Pote do 1º lugar. 2º e 3º recebem uma fração DESSE valor (não do pote
// total), conforme especificado: 50% e 30% de 0.05.
export const WEEKLY_PRIZE_SOL = envFloat('WEEKLY_PRIZE_SOL', 0.05);
export const WEEKLY_PRIZE_SPLIT = [1, 0.5, 0.3];

export function weeklyPrizeLamports(position /* 0-based */) {
  const share = WEEKLY_PRIZE_SPLIT[position];
  if (share == null) return 0;
  return Math.round(WEEKLY_PRIZE_SOL * share * LAMPORTS_PER_SOL);
}

// ── Limites anti-abuso do faucet ───────────────────────────────────────────
// O claim manda SOL real da treasury pra qualquer carteira que pedir, então
// é um faucet — e faucet sem trava é drenado por sybil (mil carteiras novas,
// mil claims). Estas são as travas mínimas; ver ARCHITECTURE.md § Segurança.

// Teto de SOL que a treasury distribui por dia, somando todos os usuários.
// Quando estoura, o claim é recusado até o dia seguinte. É a rede de
// segurança que impede a treasury de zerar em uma noite.
export const DAILY_TREASURY_BUDGET_SOL = envFloat('DAILY_TREASURY_BUDGET_SOL', 2);

// Saldo mínimo que a treasury mantém — abaixo disso, para de pagar claim
// pra sobrar SOL pros prêmios semanais já prometidos.
export const TREASURY_RESERVE_SOL = envFloat('TREASURY_RESERVE_SOL', 0.5);

// Conta nova sem nenhuma arte registrada é o perfil exato de uma sybil.
// Exigir 1 arte antes do primeiro claim faz o atacante pagar o mint do
// próprio bolso antes de receber qualquer coisa — inverte a economia.
export const REQUIRE_ART_BEFORE_FIRST_CLAIM = true;

// ── Figurinhas / troca ─────────────────────────────────────────────────────
// Troca só libera depois de fechar um ciclo de 7 dias. Evita que carteira
// descartável seja usada como mula pra concentrar figurinhas.
export const TRADE_REQUIRES_COMPLETED_STREAK = true;

// Raridades e seus pesos no sorteio do pacote.
export const RARITIES = [
  { key: 'comum',     label: 'Comum',     weight: 60, color: '#8A93A2' },
  { key: 'raro',      label: 'Raro',      weight: 25, color: '#2DD4BF' },
  { key: 'epico',     label: 'Épico',     weight: 12, color: '#8B7CF6' },
  { key: 'lendario',  label: 'Lendário',  weight:  3, color: '#FBBF24' },
];

/** Sorteia uma raridade respeitando os pesos de RARITIES. */
export function rollRarity(random = Math.random) {
  const total = RARITIES.reduce((sum, r) => sum + r.weight, 0);
  let roll = random() * total;
  for (const r of RARITIES) {
    roll -= r.weight;
    if (roll <= 0) return r;
  }
  return RARITIES[0];
}

// ── Perfil ─────────────────────────────────────────────────────────────────
export const BIO_MAX_LENGTH = 160;
export const HANDLE_MAX_LENGTH = 24;

// Redes sociais aceitas no perfil. Guardamos só o handle, nunca a URL
// completa — assim o app controla o domínio final e ninguém injeta link
// pra qualquer lugar através do campo de perfil.
export const SOCIAL_PLATFORMS = {
  instagram: { label: 'Instagram', baseUrl: 'https://instagram.com/' },
  x:         { label: 'X',         baseUrl: 'https://x.com/' },
  tiktok:    { label: 'TikTok',    baseUrl: 'https://tiktok.com/@' },
  farcaster: { label: 'Farcaster', baseUrl: 'https://warpcast.com/' },
};
