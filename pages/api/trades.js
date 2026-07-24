/**
 * pages/api/trades.js
 * GET  /api/trades?wallet=…  → propostas recebidas e enviadas
 * POST /api/trades           → propose | accept | decline | cancel
 *
 * COMO A TROCA É ATÔMICA SEM PROGRAMA ON-CHAIN
 *
 * As figurinhas estão nas carteiras dos usuários, e não existe um programa
 * nosso que possa mover as duas numa transação só. Se cada lado
 * simplesmente transferisse para o outro, quem transferisse primeiro ficaria
 * refém da boa vontade do segundo.
 *
 * A solução é a vault custodial que o marketplace já usa (lib/vaultSigner.js):
 *   1. propor  → quem propõe deposita a figurinha na vault
 *   2. aceitar → quem aceita deposita a dele; o servidor confirma que a vault
 *                tem AS DUAS e só então distribui
 *   3. recusar/cancelar/expirar → a vault devolve
 *
 * A conferência do passo 2 é o ponto: nada é distribuído antes de as duas
 * pernas estarem custodiadas, então não existe estado em que um lado entregou
 * e o outro não.
 */

import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { getLatestPin, mutatePin, MutationAbort } from '../../lib/pinataStore';
import { TRADES, STICKERS, CLAIMS } from '../../lib/collections';
import { rateLimit, clientIp } from '../../lib/rateLimit';
import { SOLANA_ADDR_RE } from '../../lib/social/profile';
import { getVaultAddress, verifyVaultHoldsMint, transferFromVault } from '../../lib/vaultSigner';
import {
  buildProposeTradeMessage, buildRespondTradeMessage, TRADE_TTL_MS,
} from '../../lib/stickers/tradeSignature';
import { TRADE_REQUIRES_COMPLETED_STREAK } from '../../lib/config';

const SIGNATURE_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT = 15;
const RATE_WINDOW_MS = 10 * 60 * 1000;

const asArray = (v) => (Array.isArray(v) ? v : []);
const asMap = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

function verify(message, wallet, signature) {
  try {
    const sigBytes = Buffer.from(signature, 'base64');
    if (sigBytes.length !== 64) return false;
    const pubkeyBytes = bs58.decode(wallet);
    if (pubkeyBytes.length !== 32) return false;
    return nacl.sign.detached.verify(new TextEncoder().encode(message), sigBytes, pubkeyBytes);
  } catch {
    return false;
  }
}

/** Proposta vencida deixa de valer sozinha — sem isso o álbum encheria de
 *  oferta morta sobre figurinha que o dono já trocou com outra pessoa. */
function isExpired(trade, now = Date.now()) {
  return trade.status === 'pendente' && now > (trade.expiresAt || 0);
}

function publicTrade(trade) {
  return { ...trade, status: isExpired(trade) ? 'expirada' : trade.status };
}

export default async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');

  const jwt = process.env.PINATA_JWT;
  if (!jwt) return res.status(500).json({ error: 'Servidor não configurado.' });

  // ── GET ──────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const wallet = typeof req.query.wallet === 'string' ? req.query.wallet.trim() : '';
    if (!SOLANA_ADDR_RE.test(wallet)) {
      return res.status(400).json({ error: 'Endereço de carteira inválido.' });
    }

    try {
      const trades = asArray(await getLatestPin(jwt, TRADES, []));
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({
        received: trades.filter(t => t?.toWallet === wallet).map(publicTrade),
        sent: trades.filter(t => t?.fromWallet === wallet).map(publicTrade),
        // O cliente precisa deste endereço pra depositar a figurinha antes de
        // propor ou aceitar. Vem do servidor, e não hardcoded no bundle, pra
        // que trocar a vault não exija redeploy do front.
        vaultAddress: getVaultAddress(),
      });
    } catch (err) {
      console.error('[/api/trades GET]', err.message);
      return res.status(500).json({ error: 'Erro ao carregar as trocas.' });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const limit = rateLimit(`trades:${clientIp(req)}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!limit.ok) {
    res.setHeader('Retry-After', Math.ceil(limit.retryAfterMs / 1000));
    return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' });
  }

  const body = req.body || {};
  const wallet = typeof body.wallet === 'string' ? body.wallet.trim() : '';
  const action = body.action;
  const timestamp = body.timestamp;

  if (!SOLANA_ADDR_RE.test(wallet)) return res.status(400).json({ error: 'Carteira inválida.' });
  if (!['propose', 'accept', 'decline', 'cancel'].includes(action)) {
    return res.status(400).json({ error: 'Ação inválida.' });
  }
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) ||
      Math.abs(Date.now() - timestamp) > SIGNATURE_WINDOW_MS) {
    return res.status(400).json({ error: 'Autorização expirada. Tente de novo.' });
  }
  if (typeof body.signature !== 'string' || !body.signature) {
    return res.status(401).json({ error: 'Assinatura da carteira ausente.' });
  }

  try {
    if (action === 'propose') return await handlePropose({ res, jwt, body, wallet, timestamp });
    return await handleRespond({ res, jwt, body, wallet, timestamp, action });
  } catch (err) {
    console.error('[/api/trades POST]', err.message);
    return res.status(500).json({ error: 'Não foi possível concluir a operação.' });
  }
}

/** Quem propõe já depositou a figurinha na vault antes de chamar isto. */
async function handlePropose({ res, jwt, body, wallet, timestamp }) {
  const toWallet = typeof body.toWallet === 'string' ? body.toWallet.trim() : '';
  const offeredMint = typeof body.offeredMint === 'string' ? body.offeredMint.trim() : '';
  const requestedMint = typeof body.requestedMint === 'string' ? body.requestedMint.trim() : '';

  if (!SOLANA_ADDR_RE.test(toWallet)) return res.status(400).json({ error: 'Carteira de destino inválida.' });
  if (!SOLANA_ADDR_RE.test(offeredMint) || !SOLANA_ADDR_RE.test(requestedMint)) {
    return res.status(400).json({ error: 'Figurinha inválida.' });
  }
  if (toWallet === wallet) return res.status(400).json({ error: 'Você não pode trocar consigo mesmo.' });

  const message = buildProposeTradeMessage({ fromWallet: wallet, toWallet, offeredMint, requestedMint, timestamp });
  if (!verify(message, wallet, body.signature)) {
    return res.status(401).json({ error: 'Assinatura inválida — a carteira não autorizou esta proposta.' });
  }

  const [stickersRaw, claimsRaw] = await Promise.all([
    getLatestPin(jwt, STICKERS, []),
    getLatestPin(jwt, CLAIMS, {}),
  ]);
  const stickers = asArray(stickersRaw);

  // Troca liberada só depois de um ciclo de 7 dias. Evita carteira
  // descartável usada como mula pra concentrar figurinhas — quem quiser
  // fazer isso precisa manter 7 dias de streak em cada conta.
  if (TRADE_REQUIRES_COMPLETED_STREAK) {
    const claim = asMap(claimsRaw)[wallet];
    if ((claim?.completedCycles || 0) < 1) {
      return res.status(403).json({
        error: 'Complete 7 dias seguidos de claim para liberar as trocas.',
      });
    }
  }

  const offered = stickers.find(s => s?.mint === offeredMint);
  const requested = stickers.find(s => s?.mint === requestedMint);

  if (!offered || !requested) return res.status(404).json({ error: 'Figurinha não encontrada.' });
  if (offered.owner !== wallet) return res.status(403).json({ error: 'A figurinha oferecida não é sua.' });
  if (requested.owner !== toWallet) return res.status(409).json({ error: 'A figurinha pedida não é mais dessa carteira.' });

  // Colada é definitiva; só repetida circula. Ver lib/stickers/album.js.
  if (offered.pasted) return res.status(400).json({ error: 'Figurinha colada não pode ser trocada.' });
  if (requested.pasted) return res.status(400).json({ error: 'A figurinha pedida está colada no álbum do dono.' });

  // A vault precisa JÁ ter recebido a figurinha oferecida. Aceitar a proposta
  // sem esse depósito deixaria criar ofertas de figurinha que não se tem.
  if (!(await verifyVaultHoldsMint(offeredMint))) {
    return res.status(409).json({
      error: 'A figurinha ainda não chegou à custódia. Confirme a transferência e tente de novo.',
    });
  }

  const now = Date.now();
  const trade = {
    id: `t-${now}-${Math.random().toString(36).slice(2, 9)}`,
    fromWallet: wallet,
    toWallet,
    offeredMint,
    requestedMint,
    status: 'pendente',
    createdAt: now,
    expiresAt: now + TRADE_TTL_MS,
  };

  const mutation = await mutatePin(jwt, TRADES, [], (raw) => {
    const trades = asArray(raw);

    // Uma figurinha só pode estar comprometida numa proposta por vez — ela
    // está fisicamente na vault, então uma segunda oferta prometeria algo
    // que já foi prometido.
    const jaOfertada = trades.some(
      t => t?.offeredMint === offeredMint && t.status === 'pendente' && !isExpired(t, now)
    );
    if (jaOfertada) throw new MutationAbort({ error: 'Esta figurinha já está em outra proposta.', code: 409 });

    return { data: [...trades, trade], result: { trade } };
  });

  if (mutation.aborted) {
    const p = mutation.payload || {};
    return res.status(p.code || 409).json({ error: p.error });
  }
  if (!mutation.ok) return res.status(502).json({ error: 'Falha ao registrar a proposta.' });

  return res.status(200).json({ ok: true, trade });
}

/** accept | decline | cancel */
async function handleRespond({ res, jwt, body, wallet, timestamp, action }) {
  const tradeId = typeof body.tradeId === 'string' ? body.tradeId : '';
  if (!tradeId) return res.status(400).json({ error: 'Proposta inválida.' });

  const decision = action === 'accept' ? 'accept' : action === 'cancel' ? 'cancel' : 'decline';
  const message = buildRespondTradeMessage({ tradeId, wallet, decision, timestamp });
  if (!verify(message, wallet, body.signature)) {
    return res.status(401).json({ error: 'Assinatura inválida — a carteira não autorizou esta resposta.' });
  }

  const trades = asArray(await getLatestPin(jwt, TRADES, []));
  const trade = trades.find(t => t?.id === tradeId);

  if (!trade) return res.status(404).json({ error: 'Proposta não encontrada.' });
  if (trade.status !== 'pendente') return res.status(409).json({ error: 'Esta proposta já foi respondida.' });
  if (isExpired(trade)) return res.status(409).json({ error: 'Esta proposta expirou.' });

  // Quem propôs cancela; quem recebeu aceita ou recusa. Sem essa checagem,
  // qualquer um responderia proposta alheia.
  const isOwner = trade.toWallet === wallet;
  const isProposer = trade.fromWallet === wallet;
  if (decision === 'cancel' && !isProposer) return res.status(403).json({ error: 'Só quem propôs pode cancelar.' });
  if (decision !== 'cancel' && !isOwner) return res.status(403).json({ error: 'Esta proposta não é para você.' });

  // ── Recusa ou cancelamento: devolve o que está custodiado ────────────────
  if (decision !== 'accept') {
    try {
      if (await verifyVaultHoldsMint(trade.offeredMint)) {
        await transferFromVault({ mint: trade.offeredMint, toWallet: trade.fromWallet });
      }
    } catch (err) {
      // A figurinha fica na vault e recuperável; não bloqueamos o
      // encerramento da proposta por causa disso.
      console.error('[/api/trades] devolução falhou', trade.id, err.message);
      return res.status(502).json({ error: 'Não foi possível devolver a figurinha. Tente de novo.' });
    }

    await closeTrade(jwt, tradeId, decision === 'cancel' ? 'cancelada' : 'recusada');
    return res.status(200).json({ ok: true, status: decision === 'cancel' ? 'cancelada' : 'recusada' });
  }

  // ── Aceite ───────────────────────────────────────────────────────────────
  // Quem aceita já depositou a figurinha pedida na vault antes de chamar.
  // Conferimos AS DUAS antes de mover qualquer uma — é isso que garante que
  // não existe estado em que um lado entregou e o outro não.
  const [temOferecida, temPedida] = await Promise.all([
    verifyVaultHoldsMint(trade.offeredMint),
    verifyVaultHoldsMint(trade.requestedMint),
  ]);

  if (!temOferecida) {
    return res.status(409).json({ error: 'A figurinha oferecida não está mais em custódia. Proposta inválida.' });
  }
  if (!temPedida) {
    return res.status(409).json({
      error: 'Sua figurinha ainda não chegou à custódia. Confirme a transferência e tente de novo.',
    });
  }

  // Marca como aceita ANTES de distribuir: se o processo cair no meio, a
  // proposta não volta a ficar pendente e ninguém aceita duas vezes.
  const claimed = await mutatePin(jwt, TRADES, [], (raw) => {
    const list = asArray(raw);
    const current = list.find(t => t?.id === tradeId);
    if (!current || current.status !== 'pendente') {
      throw new MutationAbort({ error: 'Esta proposta já foi respondida.', code: 409 });
    }
    return {
      data: list.map(t => (t.id === tradeId ? { ...t, status: 'aceita', resolvedAt: Date.now() } : t)),
      result: { ok: true },
    };
  });

  if (claimed.aborted) {
    const p = claimed.payload || {};
    return res.status(p.code || 409).json({ error: p.error });
  }
  if (!claimed.ok) return res.status(502).json({ error: 'Falha ao registrar o aceite.' });

  const signatures = [];
  try {
    // Quem aceitou recebe primeiro: é quem acabou de depositar, então é quem
    // está exposto há menos tempo.
    signatures.push(await transferFromVault({ mint: trade.offeredMint, toWallet: trade.toWallet }));
    signatures.push(await transferFromVault({ mint: trade.requestedMint, toWallet: trade.fromWallet }));
  } catch (err) {
    // As duas figurinhas estão na vault e nenhuma se perdeu — a que faltou
    // entregar continua custodiada e é recuperável manualmente.
    console.error('[/api/trades] ENTREGA PARCIAL', trade.id, { signatures, erro: err.message });
    return res.status(502).json({
      error: 'A troca foi registrada mas uma das entregas falhou. Fale com o suporte.',
    });
  }

  await applyOwnership(jwt, trade);
  await recordSignatures(jwt, tradeId, signatures);

  return res.status(200).json({ ok: true, status: 'aceita', signatures });
}

async function closeTrade(jwt, tradeId, status) {
  await mutatePin(jwt, TRADES, [], (raw) => ({
    data: asArray(raw).map(t => (t?.id === tradeId ? { ...t, status, resolvedAt: Date.now() } : t)),
    result: { ok: true },
  })).catch(err => console.error('[/api/trades] closeTrade', err.message));
}

/**
 * Atualiza o dono das duas figurinhas no nosso registro.
 *
 * A chain já é a verdade sobre posse — isto é o cache que monta o álbum sem
 * uma chamada RPC por figurinha. `source: 'troca'` importa: figurinha vinda
 * de troca não conta como pacote aberto (ver packsAvailable), senão trocar
 * figurinhas geraria pacotes do nada.
 */
async function applyOwnership(jwt, trade) {
  await mutatePin(jwt, STICKERS, [], (raw) => ({
    data: asArray(raw).map(s => {
      if (s?.mint === trade.offeredMint) return { ...s, owner: trade.toWallet, source: 'troca', pasted: false };
      if (s?.mint === trade.requestedMint) return { ...s, owner: trade.fromWallet, source: 'troca', pasted: false };
      return s;
    }),
    result: { ok: true },
  })).catch(err => console.error('[/api/trades] applyOwnership', err.message));
}

async function recordSignatures(jwt, tradeId, signatures) {
  await mutatePin(jwt, TRADES, [], (raw) => ({
    data: asArray(raw).map(t => (t?.id === tradeId ? { ...t, signatures } : t)),
    result: { ok: true },
  })).catch(err => console.error('[/api/trades] recordSignatures', err.message));
}
