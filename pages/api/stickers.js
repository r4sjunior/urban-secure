/**
 * pages/api/stickers.js
 * GET  /api/stickers?wallet=…  → álbum, bolso, repetidas e pacotes a abrir
 * POST /api/stickers           → abre um pacote (action: 'open')
 *                                cola uma figurinha (action: 'paste')
 *
 * Abrir um pacote MINTA um NFT pago pela treasury, então tem as mesmas
 * preocupações do claim: assinatura da carteira, rate limit e — o principal —
 * uma reserva atômica antes de mintar, pra que uma falha no meio não permita
 * abrir o mesmo pacote duas vezes.
 */

import nacl from 'tweetnacl';
import { guardServerConfig } from '../../lib/serverConfig';
import bs58 from 'bs58';
import { getLatestPin, getLatestPinStrict, mutatePin, MutationAbort } from '../../lib/pinataStore';
import { STICKERS, CLAIMS, REGISTRY } from '../../lib/collections';
import { rateLimit, clientIp } from '../../lib/rateLimit';
import { SOLANA_ADDR_RE } from '../../lib/social/profile';
import { buildAlbum, packsAvailable } from '../../lib/stickers/album';
import { pickArt, albumNumberOf, rollRarity } from '../../lib/stickers/rarity';
import { mintSticker } from '../../lib/stickers/mintSticker';
import { buildStickerActionMessage } from '../../lib/stickers/stickerSignature';
/**
 * A Vercel corta funções em 10s por padrão. Esta rota espera a confirmação
 * de uma transação na Solana, o que pode passar disso — e o corte acontece
 * DEPOIS de o SOL já ter saído: o usuário vê erro, mas foi pago. Pior, a
 * resposta cortada vem em HTML, e o cliente quebra ao tentar lê-la como JSON.
 */
export const config = { maxDuration: 60 };

const SIGNATURE_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 10 * 60 * 1000;

function verifySignature({ wallet, action, target, timestamp, signature }) {
  try {
    const sigBytes = Buffer.from(signature, 'base64');
    if (sigBytes.length !== 64) return false;
    const pubkeyBytes = bs58.decode(wallet);
    if (pubkeyBytes.length !== 32) return false;
    const message = buildStickerActionMessage({ wallet, action, target, timestamp });
    return nacl.sign.detached.verify(new TextEncoder().encode(message), sigBytes, pubkeyBytes);
  } catch {
    return false;
  }
}

const asArray = (v) => (Array.isArray(v) ? v : []);
const asMap = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

export default async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');

  const jwt = process.env.PINATA_JWT;
  if (!jwt) return res.status(500).json({ error: 'Servidor não configurado.' });

  // Diagnóstico antes de qualquer I/O: credencial faltando produz uma
  // mensagem acionável, não um erro genérico que pede para tentar de novo.
  if (guardServerConfig(res, { precisaTreasury: req.method === 'POST' })) return;

  // ── GET: álbum completo ──────────────────────────────────────────────────
  if (req.method === 'GET') {
    const wallet = typeof req.query.wallet === 'string' ? req.query.wallet.trim() : '';
    if (!SOLANA_ADDR_RE.test(wallet)) {
      return res.status(400).json({ error: 'Endereço de carteira inválido.' });
    }

    try {
      const [stickers, arts, claims] = await Promise.all([
        getLatestPin(jwt, STICKERS, []),
        getLatestPin(jwt, REGISTRY, []),
        getLatestPin(jwt, CLAIMS, {}),
      ]);

      const claimState = asMap(claims)[wallet] || null;
      const album = buildAlbum({ wallet, arts: asArray(arts), stickers: asArray(stickers) });

      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({
        album: {
          slots: album.slots.map(s => ({
            albumNumber: s.albumNumber,
            artId: s.artId,
            filled: s.filled,
            canPaste: s.canPaste,
            // Só o necessário pra desenhar o slot — mandar a arte inteira
            // multiplicaria o tamanho da resposta por nada.
            art: {
              name: s.art.name,
              artistName: s.art.artistName,
              artistWallet: s.art.artistWallet,
              imageUrl: s.art.imageUrl,
            },
            sticker: s.sticker ? { mint: s.sticker.mint, rarity: s.sticker.rarity } : null,
          })),
          pocket: album.pocket,
          duplicates: album.duplicates,
          pastedCount: album.pastedCount,
          totalSlots: album.totalSlots,
          completion: album.completion,
        },
        packsAvailable: packsAvailable({ wallet, claimState, stickers: asArray(stickers) }),
        canTrade: (claimState?.completedCycles || 0) >= 1,
      });
    } catch (err) {
      console.error('[/api/stickers GET]', err.message);
      return res.status(500).json({ error: 'Erro ao carregar o álbum.' });
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── POST ─────────────────────────────────────────────────────────────────
  const limit = rateLimit(`stickers:${clientIp(req)}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!limit.ok) {
    res.setHeader('Retry-After', Math.ceil(limit.retryAfterMs / 1000));
    return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' });
  }

  const body = req.body || {};
  const wallet = typeof body.wallet === 'string' ? body.wallet.trim() : '';
  const action = body.action;

  if (!SOLANA_ADDR_RE.test(wallet)) {
    return res.status(400).json({ error: 'Endereço de carteira inválido.' });
  }
  if (action !== 'open' && action !== 'paste') {
    return res.status(400).json({ error: 'Ação inválida.' });
  }

  const timestamp = body.timestamp;
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) ||
      Math.abs(Date.now() - timestamp) > SIGNATURE_WINDOW_MS) {
    return res.status(400).json({ error: 'Autorização expirada. Tente de novo.' });
  }
  if (typeof body.signature !== 'string' || !body.signature) {
    return res.status(401).json({ error: 'Assinatura da carteira ausente.' });
  }

  const target = action === 'paste' ? String(body.mint || '') : '';
  if (!verifySignature({ wallet, action, target, timestamp, signature: body.signature })) {
    return res.status(401).json({ error: 'Assinatura inválida — a carteira não autorizou esta ação.' });
  }

  try {
    if (action === 'paste') return await handlePaste({ res, jwt, wallet, mint: target });
    return await handleOpen({ res, jwt, wallet });
  } catch (err) {
    console.error('[/api/stickers POST]', err.message);
    return res.status(500).json({ error: 'Não foi possível concluir a ação.' });
  }
}

/**
 * Cola uma figurinha no álbum. Irreversível por design.
 */
async function handlePaste({ res, jwt, wallet, mint }) {
  if (!SOLANA_ADDR_RE.test(mint)) {
    return res.status(400).json({ error: 'Figurinha inválida.' });
  }

  const arts = asArray(await getLatestPin(jwt, REGISTRY, []));

  const mutation = await mutatePin(jwt, STICKERS, [], (raw) => {
    const stickers = asArray(raw);
    const index = stickers.findIndex(s => s?.mint === mint);

    if (index < 0) throw new MutationAbort({ error: 'Figurinha não encontrada.', code: 404 });

    const sticker = stickers[index];
    if (sticker.owner !== wallet) {
      throw new MutationAbort({ error: 'Esta figurinha não é sua.', code: 403 });
    }
    if (sticker.pasted) {
      throw new MutationAbort({ error: 'Esta figurinha já está colada.', code: 409 });
    }

    // Revalida sobre o estado mais recente: entre a leitura do álbum na tela
    // e este clique, outra aba pode ter colado uma figurinha da mesma arte.
    const album = buildAlbum({ wallet, arts, stickers });
    const slot = album.slots.find(s => s.artId === sticker.artId);
    if (slot?.filled) {
      throw new MutationAbort({
        error: 'Você já tem esta figurinha colada. Use a repetida para trocar.',
        code: 409,
      });
    }

    const next = [...stickers];
    next[index] = { ...sticker, pasted: true, pastedAt: Date.now() };
    return { data: next, result: { sticker: next[index] } };
  });

  if (mutation.aborted) {
    const p = mutation.payload || {};
    return res.status(p.code || 400).json({ error: p.error || 'Não foi possível colar.' });
  }
  if (!mutation.ok) {
    return res.status(502).json({ error: 'Falha ao colar a figurinha. Tente de novo.' });
  }

  return res.status(200).json({ ok: true, sticker: mutation.result.sticker });
}

/**
 * Abre um pacote: sorteia, minta e registra.
 *
 * Mesma disciplina do claim (pages/api/claim.js): RESERVA antes de mintar.
 * O mint é irreversível e o servidor pode morrer entre mintar e gravar; se
 * gravássemos só depois, uma queda deixaria o saldo de pacotes intacto e o
 * retry mintaria de novo — figurinha de graça, paga pela treasury. Com a
 * reserva, a queda custa um pacote ao usuário, que é o lado certo do erro.
 */
async function handleOpen({ res, jwt, wallet }) {
  // Figurinhas e claims usam leitura ESTRITA: são elas que decidem se há
  // pacote a abrir, e um resultado vazio por falha de rede seria lido como
  // "nenhum pacote consumido ainda", liberando mints infinitos pagos pela
  // treasury. O registry pode ser tolerante — sem artes, o sorteio recusa
  // sozinho e nada é gasto.
  const [stickersRaw, artsRaw, claimsRaw] = await Promise.all([
    getLatestPinStrict(jwt, STICKERS, []),
    getLatestPin(jwt, REGISTRY, []),
    getLatestPinStrict(jwt, CLAIMS, {}),
  ]);

  const stickers = asArray(stickersRaw);
  const arts = asArray(artsRaw);
  const claimState = asMap(claimsRaw)[wallet] || null;

  if (packsAvailable({ wallet, claimState, stickers }) <= 0) {
    return res.status(403).json({
      error: 'Você não tem pacotes para abrir. Complete 7 dias seguidos de claim.',
    });
  }

  // Sorteio: raridade e obra. Roda no SERVIDOR — sortear no cliente deixaria
  // o resultado à mercê de quem abre o console.
  const art = pickArt(arts, stickers, { excludeWallet: wallet });
  if (!art) {
    return res.status(503).json({
      error: 'Ainda não há artes suficientes registradas para gerar figurinhas.',
    });
  }

  const rarity = rollRarity().key;
  const albumNumber = albumNumberOf(art, arts);
  const reservationId = `pending-${wallet}-${Date.now()}`;

  // 1. Reserva o pacote gravando um registro pendente. Ele já conta como
  //    "pacote aberto" em packsAvailable (mintedFor + source), então uma
  //    segunda chamada simultânea não passa da checagem acima.
  const reservation = await mutatePin(jwt, STICKERS, [], (raw) => {
    const current = asArray(raw);
    if (packsAvailable({ wallet, claimState, stickers: current }) <= 0) {
      throw new MutationAbort({ error: 'Você não tem pacotes para abrir.', code: 403 });
    }
    const pending = {
      mint: reservationId,
      owner: wallet,
      mintedFor: wallet,
      artId: art.id,
      artistName: art.artistName || 'Anônimo',
      artistWallet: art.artistWallet || '',
      imageUrl: art.imageUrl,
      rarity,
      albumNumber,
      source: 'streak',
      pasted: false,
      pending: true,
      mintedAt: Date.now(),
      signature: '',
    };
    return { data: [...current, pending], result: { ok: true } };
  });

  if (reservation.aborted) {
    const p = reservation.payload || {};
    return res.status(p.code || 403).json({ error: p.error });
  }
  if (!reservation.ok) {
    return res.status(502).json({ error: 'Não foi possível abrir o pacote. Tente de novo.' });
  }

  // 2. Minta (irreversível)
  let minted;
  try {
    minted = await mintSticker({ jwt, toWallet: wallet, art, rarity, albumNumber });
  } catch (err) {
    console.error('[/api/stickers] mint falhou:', err.message);
    // Devolve o pacote — o mint não aconteceu, então o usuário não perdeu nada.
    await mutatePin(jwt, STICKERS, [], (raw) => ({
      data: asArray(raw).filter(s => s?.mint !== reservationId),
      result: { ok: true },
    })).catch(() => {});
    return res.status(502).json({ error: 'Não foi possível gerar a figurinha. Tente de novo.' });
  }

  // 3. Converte a reserva no registro definitivo
  const confirmation = await mutatePin(jwt, STICKERS, [], (raw) => {
    const current = asArray(raw);
    const index = current.findIndex(s => s?.mint === reservationId);
    const finalSticker = {
      ...(index >= 0 ? current[index] : {}),
      mint: minted.mint,
      signature: minted.signature,
      pending: false,
      mintedAt: Date.now(),
    };
    const next = index >= 0
      ? current.map((s, i) => (i === index ? finalSticker : s))
      : [...current, finalSticker];
    return { data: next, result: { sticker: finalSticker } };
  });

  if (!confirmation.ok) {
    // A figurinha existe on-chain e é do usuário; só o nosso registro ficou
    // com o id provisório. Logamos alto porque exige conserto manual.
    console.error('[/api/stickers] MINTOU MAS NÃO CONFIRMOU', { wallet, mint: minted.mint });
  }

  return res.status(200).json({
    ok: true,
    sticker: confirmation.result?.sticker || {
      mint: minted.mint, artId: art.id, rarity, albumNumber,
      artistName: art.artistName, imageUrl: art.imageUrl,
    },
    art: {
      id: art.id, name: art.name,
      artistName: art.artistName, artistWallet: art.artistWallet,
      imageUrl: art.imageUrl,
    },
    rarity,
    albumNumber,
    signature: minted.signature,
  });
}
