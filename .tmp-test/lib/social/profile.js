/**
 * lib/social/profile.js
 * Validação e normalização de perfil — funções puras, sem I/O.
 *
 * Roda nos DOIS lados de propósito: no cliente pra dar feedback imediato no
 * formulário, e no servidor porque validação de cliente não é validação (o
 * POST pode vir de curl). Como o servidor é quem manda, um perfil normalizado
 * aqui é idêntico ao que vai ser persistido — o cliente consegue calcular o
 * hash da assinatura sabendo exatamente o que o servidor vai gravar.
 */

import { sanitize } from '../sanitize.js';
import { BIO_MAX_LENGTH, HANDLE_MAX_LENGTH, SOCIAL_PLATFORMS } from '../config.js';

export const SOLANA_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// Handle de rede social: letras, números, ponto e underscore. É o conjunto
// que Instagram/X/TikTok aceitam, e exclui `/` e `.` iniciais — que seriam
// o caminho pra escapar do baseUrl e apontar o link pra outro domínio.
const SOCIAL_HANDLE_RE = /^[A-Za-z0-9._]{1,30}$/;

/** Só o gateway do Pinata é aceito como avatar. Mesma regra de imageUrl em
 *  /api/registry: sem isso, o campo vira um tracker de terceiros carregado
 *  em toda visualização de perfil. */
const AVATAR_PREFIX = 'https://gateway.pinata.cloud/ipfs/';

/** Perfil de quem ainda não criou um. Devolvido em vez de null pra UI nunca
 *  precisar tratar ausência — carteira sem perfil é uma carteira com perfil
 *  vazio, e o app tem menos caminhos. */
export function defaultProfile(wallet) {
  return {
    wallet,
    handle: '',
    bio: '',
    avatarUrl: '',
    socials: {},
    createdAt: 0,
    updatedAt: 0,
  };
}

/** Nome exibido quando o usuário não definiu handle. */
export function displayName(profile, wallet) {
  const addr = profile?.wallet || wallet || '';
  return profile?.handle?.trim() || shortWallet(addr);
}

export function shortWallet(wallet) {
  if (typeof wallet !== 'string' || wallet.length < 8) return wallet || '';
  return `${wallet.slice(0, 4)}…${wallet.slice(-4)}`;
}

/**
 * Cor derivada da carteira — avatar de fallback estável.
 * Determinística: a mesma carteira sempre gera a mesma cor, em qualquer
 * dispositivo, sem precisar guardar nada.
 */
export function walletColor(wallet) {
  let hash = 0;
  for (let i = 0; i < (wallet || '').length; i++) {
    hash = (hash * 31 + wallet.charCodeAt(i)) >>> 0;
  }
  return `hsl(${hash % 360}, 65%, 55%)`;
}

/** Monta a URL da rede social a partir do handle guardado. */
export function socialUrl(platform, handle) {
  const cfg = SOCIAL_PLATFORMS[platform];
  if (!cfg || !handle) return '';
  return cfg.baseUrl + handle;
}

/** Aceita o que o usuário digitar (`@nome`, URL colada, nome puro) e extrai
 *  só o handle. Colar a URL do próprio perfil é o gesto natural — recusar
 *  isso seria correto e inútil. */
export function normalizeSocialHandle(raw) {
  if (typeof raw !== 'string') return '';
  let v = raw.trim();
  if (!v) return '';

  // URL colada: fica com o último segmento não vazio do caminho
  if (v.includes('/')) {
    const parts = v.split('?')[0].split('#')[0].split('/').filter(Boolean);
    v = parts[parts.length - 1] || '';
  }
  return v.replace(/^@/, '').slice(0, 30);
}

/**
 * Normaliza um perfil vindo do cliente para a forma exata que será
 * persistida. Campos inválidos são DESCARTADOS, não rejeitados: um handle
 * de Instagram com caractere estranho não deve impedir alguém de salvar a
 * bio. O que é rejeitado de verdade fica em `validateProfile`.
 */
export function normalizeProfile(input, wallet) {
  const socials = {};
  const rawSocials = input?.socials && typeof input.socials === 'object' ? input.socials : {};

  for (const platform of Object.keys(SOCIAL_PLATFORMS)) {
    const handle = normalizeSocialHandle(rawSocials[platform]);
    if (handle && SOCIAL_HANDLE_RE.test(handle)) socials[platform] = handle;
  }

  const rawAvatar = typeof input?.avatarUrl === 'string' ? input.avatarUrl.trim() : '';
  const avatarUrl = rawAvatar.startsWith(AVATAR_PREFIX) ? rawAvatar : '';

  return {
    wallet,
    handle: sanitize(input?.handle, HANDLE_MAX_LENGTH),
    bio: sanitize(input?.bio, BIO_MAX_LENGTH),
    avatarUrl,
    socials,
  };
}

/**
 * Valida um perfil JÁ normalizado.
 * @returns {{ ok: boolean, error?: string }}
 */
export function validateProfile(profile) {
  if (!profile?.wallet || !SOLANA_ADDR_RE.test(profile.wallet)) {
    return { ok: false, error: 'Endereço de carteira inválido.' };
  }
  // Handle é opcional — quem não define aparece como o endereço encurtado.
  if (profile.handle && profile.handle.length < 2) {
    return { ok: false, error: 'O nome precisa ter pelo menos 2 caracteres.' };
  }
  if (profile.handle.length > HANDLE_MAX_LENGTH) {
    return { ok: false, error: `O nome deve ter até ${HANDLE_MAX_LENGTH} caracteres.` };
  }
  if (profile.bio.length > BIO_MAX_LENGTH) {
    return { ok: false, error: `A bio deve ter até ${BIO_MAX_LENGTH} caracteres.` };
  }
  return { ok: true };
}
