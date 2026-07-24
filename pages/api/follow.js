/**
 * pages/api/follow.js
 * GET  /api/follow?wallet=…&viewer=…  → contadores e se o viewer já segue
 * POST /api/follow                    → seguir | deixar de seguir
 *
 * O grafo é `{ [wallet]: { followers: [], following: [] } }` — os dois lados
 * da relação, gravados na MESMA mutação. Ver lib/collections.js § FOLLOWS.
 */

import nacl from 'tweetnacl';
import { guardServerConfig } from '../../lib/serverConfig';
import bs58 from 'bs58';
import { getLatestPin, mutatePin, MutationAbort } from '../../lib/pinataStore';
import { FOLLOWS, PROFILES } from '../../lib/collections';
import { rateLimit, clientIp } from '../../lib/rateLimit';
import { SOLANA_ADDR_RE, displayName } from '../../lib/social/profile';
import { buildFollowMessage } from '../../lib/social/followSignature';

const SIGNATURE_WINDOW_MS = 10 * 60 * 1000;

// Seguir é barato, então o limite é generoso — mas existe: sem ele, um script
// inflaria a contagem de seguidores de um perfil em segundos, e o número
// deixaria de significar qualquer coisa.
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 10 * 60 * 1000;

/** Teto de quem uma carteira pode seguir. Impede que um registro cresça sem
 *  limite e estoure o tamanho do pin — e conta bot que segue 50 mil pessoas
 *  não é comportamento que valha suportar. */
const MAX_FOLLOWING = 5000;

const asMap = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const entryOf = (graph, wallet) => graph[wallet] || { followers: [], following: [] };

function verifyFollowSignature({ follower, target, action, timestamp, signature }) {
  try {
    const sigBytes = Buffer.from(signature, 'base64');
    if (sigBytes.length !== 64) return false;
    const pubkeyBytes = bs58.decode(follower);
    if (pubkeyBytes.length !== 32) return false;
    const message = buildFollowMessage({ follower, target, action, timestamp });
    return nacl.sign.detached.verify(new TextEncoder().encode(message), sigBytes, pubkeyBytes);
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');

  const jwt = process.env.PINATA_JWT;
  if (!jwt) return res.status(500).json({ error: 'Servidor não configurado.' });

  // Diagnóstico antes de qualquer I/O: credencial faltando produz uma
  // mensagem acionável, não um erro genérico que pede para tentar de novo.
  if (guardServerConfig(res)) return;

  // ── GET ──────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const wallet = typeof req.query.wallet === 'string' ? req.query.wallet.trim() : '';
    const viewer = typeof req.query.viewer === 'string' ? req.query.viewer.trim() : '';

    if (!SOLANA_ADDR_RE.test(wallet)) {
      return res.status(400).json({ error: 'Endereço de carteira inválido.' });
    }

    try {
      const graph = asMap(await getLatestPin(jwt, FOLLOWS, {}));
      const entry = entryOf(graph, wallet);

      // A lista de perfis só é carregada quando alguém pede a lista expandida
      // — a tela de perfil quer só os números, e resolver nome e avatar de
      // centenas de seguidores nesse caso seria desperdício.
      const wantsList = req.query.list === 'followers' || req.query.list === 'following';
      let list = null;

      if (wantsList) {
        const profiles = asMap(await getLatestPin(jwt, PROFILES, {}));
        const wallets = (req.query.list === 'followers' ? entry.followers : entry.following).slice(0, 200);
        list = wallets.map(w => {
          const p = profiles[w] || null;
          return { wallet: w, handle: displayName(p, w), avatarUrl: p?.avatarUrl || '' };
        });
      }

      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({
        followers: entry.followers.length,
        following: entry.following.length,
        // `null` quando não há viewer — a UI distingue "não sigo" de "não sei
        // ainda" e não pisca o botão no estado errado enquanto carrega.
        isFollowing: viewer && SOLANA_ADDR_RE.test(viewer)
          ? entry.followers.includes(viewer)
          : null,
        list,
      });
    } catch (err) {
      console.error('[/api/follow GET]', err.message);
      return res.status(500).json({ error: 'Erro ao carregar seguidores.' });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── POST ─────────────────────────────────────────────────────────────────
  const limit = rateLimit(`follow:${clientIp(req)}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!limit.ok) {
    res.setHeader('Retry-After', Math.ceil(limit.retryAfterMs / 1000));
    return res.status(429).json({ error: 'Muitas ações seguidas. Aguarde um pouco.' });
  }

  const body = req.body || {};
  const follower = typeof body.follower === 'string' ? body.follower.trim() : '';
  const target = typeof body.target === 'string' ? body.target.trim() : '';
  const action = body.action;
  const timestamp = body.timestamp;

  if (!SOLANA_ADDR_RE.test(follower) || !SOLANA_ADDR_RE.test(target)) {
    return res.status(400).json({ error: 'Endereço de carteira inválido.' });
  }
  if (follower === target) {
    return res.status(400).json({ error: 'Você não pode seguir a si mesmo.' });
  }
  if (action !== 'follow' && action !== 'unfollow') {
    return res.status(400).json({ error: 'Ação inválida.' });
  }
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) ||
      Math.abs(Date.now() - timestamp) > SIGNATURE_WINDOW_MS) {
    return res.status(400).json({ error: 'Autorização expirada. Tente de novo.' });
  }
  if (typeof body.signature !== 'string' || !body.signature) {
    return res.status(401).json({ error: 'Assinatura da carteira ausente.' });
  }
  if (!verifyFollowSignature({ follower, target, action, timestamp, signature: body.signature })) {
    return res.status(401).json({ error: 'Assinatura inválida — a carteira não autorizou esta ação.' });
  }

  try {
    const mutation = await mutatePin(jwt, FOLLOWS, {}, (raw) => {
      const graph = asMap(raw);

      const me = { ...entryOf(graph, follower) };
      const other = { ...entryOf(graph, target) };
      me.following = [...me.following];
      other.followers = [...other.followers];

      const jaSegue = other.followers.includes(follower);

      if (action === 'follow') {
        // Já seguia: não é erro, é a mesma intenção. Abortar com sucesso
        // deixa o cliente consistente sem gravar de novo — dois toques
        // rápidos no botão não podem duplicar a entrada.
        if (jaSegue) {
          throw new MutationAbort({ ok: true, followers: other.followers.length });
        }
        if (me.following.length >= MAX_FOLLOWING) {
          throw new MutationAbort({ error: 'Você atingiu o limite de perfis seguidos.', code: 409 });
        }
        me.following.push(target);
        other.followers.push(follower);
      } else {
        if (!jaSegue) {
          throw new MutationAbort({ ok: true, followers: other.followers.length });
        }
        me.following = me.following.filter(w => w !== target);
        other.followers = other.followers.filter(w => w !== follower);
      }

      return {
        data: { ...graph, [follower]: me, [target]: other },
        result: { followers: other.followers.length },
      };
    });

    if (mutation.aborted) {
      const p = mutation.payload || {};
      if (p.ok) {
        return res.status(200).json({
          ok: true,
          isFollowing: action === 'follow',
          followers: p.followers,
        });
      }
      return res.status(p.code || 400).json({ error: p.error });
    }

    if (!mutation.ok) {
      return res.status(502).json({ error: 'Não foi possível salvar. Tente de novo.' });
    }

    return res.status(200).json({
      ok: true,
      isFollowing: action === 'follow',
      followers: mutation.result.followers,
    });
  } catch (err) {
    console.error('[/api/follow POST]', err.message);
    return res.status(500).json({ error: 'Erro ao processar a ação.' });
  }
}
