/**
 * pages/api/profile.js
 * GET  /api/profile?wallet=…  → perfil público + estatísticas derivadas
 * POST /api/profile           → cria/atualiza o próprio perfil
 *
 * O POST exige assinatura ed25519 da carteira sobre o CONTEÚDO do perfil
 * (ver lib/social/profileSignature.js) — é o que impede alguém de reescrever
 * o perfil alheio via curl. Mesmo padrão de /api/registry e /api/follow.
 */

import nacl from 'tweetnacl';
import { guardServerConfig } from '../../lib/serverConfig';
import bs58 from 'bs58';
import { getLatestPin, mutatePin } from '../../lib/pinataStore';
import { PROFILES, REGISTRY, STICKERS, CLAIMS } from '../../lib/collections';
import { buildProfileMessage, hashProfileContent } from '../../lib/social/profileSignature';
import {
  normalizeProfile, validateProfile, defaultProfile, SOLANA_ADDR_RE,
} from '../../lib/social/profile';
import { computeProfileStats } from '../../lib/social/stats';

// Mesma janela de /api/registry: uma assinatura vale por 10 minutos, o que
// cobre a lentidão de aprovar na carteira sem deixar assinatura antiga
// utilizável indefinidamente.
const SIGNATURE_WINDOW_MS = 10 * 60 * 1000;

function verifyProfileSignature({ wallet, contentHash, timestamp, signature }) {
  try {
    const sigBytes = Buffer.from(signature, 'base64');
    if (sigBytes.length !== 64) return false;
    const pubkeyBytes = bs58.decode(wallet);
    if (pubkeyBytes.length !== 32) return false;
    const message = buildProfileMessage({ wallet, contentHash, timestamp });
    return nacl.sign.detached.verify(
      new TextEncoder().encode(message), sigBytes, pubkeyBytes
    );
  } catch {
    return false;
  }
}

/** Lê o mapa de perfis. É `{ [wallet]: Profile }`, não array, porque toda
 *  leitura é "o perfil desta carteira" — varrer array não escala. */
async function getProfiles(jwt) {
  const raw = await getLatestPin(jwt, PROFILES, {});
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

export default async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');

  const jwt = process.env.PINATA_JWT;
  if (!jwt) return res.status(500).json({ error: 'Servidor não configurado.' });

  // Diagnóstico antes de qualquer I/O: credencial faltando produz uma
  // mensagem acionável, não um erro genérico que pede para tentar de novo.
  if (guardServerConfig(res)) return;

  // ── GET: perfil público + stats ──────────────────────────────────────────
  if (req.method === 'GET') {
    const wallet = typeof req.query.wallet === 'string' ? req.query.wallet.trim() : '';
    if (!SOLANA_ADDR_RE.test(wallet)) {
      return res.status(400).json({ error: 'Endereço de carteira inválido.' });
    }

    try {
      // As quatro coleções em paralelo — são independentes, e serializar
      // custaria ~4 round-trips ao gateway do IPFS numa tela que abre muito.
      const [profiles, arts, stickers, claims] = await Promise.all([
        getProfiles(jwt),
        getLatestPin(jwt, REGISTRY, []),
        getLatestPin(jwt, STICKERS, []),
        getLatestPin(jwt, CLAIMS, {}),
      ]);

      const profile = profiles[wallet] || defaultProfile(wallet);
      const stats = computeProfileStats({
        wallet,
        arts: Array.isArray(arts) ? arts : [],
        stickers: Array.isArray(stickers) ? stickers : [],
        claimState: claims?.[wallet] || null,
      });

      // Cache curto: o perfil muda pouco, mas as stats mudam a cada arte
      // registrada — 15s mantém a tela viva sem martelar o IPFS.
      res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=120');
      return res.status(200).json({ profile, stats });
    } catch (err) {
      console.error('[/api/profile GET]', err.message);
      return res.status(500).json({ error: 'Erro ao carregar perfil.' });
    }
  }

  // ── POST: salvar o próprio perfil ────────────────────────────────────────
  if (req.method === 'POST') {
    try {
      const body = req.body || {};
      const wallet = typeof body.wallet === 'string' ? body.wallet.trim() : '';

      if (!SOLANA_ADDR_RE.test(wallet)) {
        return res.status(400).json({ error: 'Endereço de carteira inválido.' });
      }

      const timestamp = body.timestamp;
      if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) ||
          Math.abs(Date.now() - timestamp) > SIGNATURE_WINDOW_MS) {
        return res.status(400).json({ error: 'Timestamp inválido ou expirado. Tente salvar de novo.' });
      }

      if (typeof body.signature !== 'string' || !body.signature) {
        return res.status(401).json({ error: 'Assinatura da carteira ausente.' });
      }

      // Normaliza ANTES de verificar a assinatura: o cliente assina o hash do
      // conteúdo normalizado, então o servidor precisa chegar exatamente ao
      // mesmo objeto pra que os hashes batam. Se normalizasse depois, um
      // campo que o servidor descarta (handle de rede inválido, por exemplo)
      // mudaria o hash e a assinatura legítima seria recusada.
      const normalized = normalizeProfile(body, wallet);

      const validation = validateProfile(normalized);
      if (!validation.ok) return res.status(400).json({ error: validation.error });

      const contentHash = hashProfileContent(normalized);
      if (!verifyProfileSignature({ wallet, contentHash, timestamp, signature: body.signature })) {
        return res.status(401).json({
          error: 'Assinatura inválida — a carteira não confirmou estas alterações.',
        });
      }

      const now = Date.now();
      const mutation = await mutatePin(jwt, PROFILES, {}, (raw) => {
        const profiles = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
        const previous = profiles[wallet];

        const profile = {
          ...normalized,
          createdAt: previous?.createdAt || now,
          updatedAt: now,
        };

        return { data: { ...profiles, [wallet]: profile }, result: { profile } };
      });

      if (!mutation.ok) {
        console.error('[/api/profile POST] falha ao salvar pin:', mutation.error);
        return res.status(502).json({ error: 'Falha ao salvar o perfil. Tente de novo.' });
      }

      return res.status(200).json({ ok: true, profile: mutation.result.profile });
    } catch (err) {
      console.error('[/api/profile POST]', err.message);
      return res.status(500).json({ error: 'Erro ao salvar perfil.' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
