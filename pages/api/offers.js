/**
 * pages/api/offers.js
 * Propostas de lance (5x/10x/20x/50x) pós-24h — Pinata/IPFS.
 * Propor não custa nada e não move dinheiro: só depois que o dono da obra
 * aceita é que o comprador paga e minta a edição (via /api/collects, que
 * verifica se existe uma proposta aceita pra esse comprador+tier).
 *
 * GET  ?postId=...                                        → propostas da obra
 * POST { action:'propose', postId, buyerWallet, tier, timestamp, signature }
 * POST { action:'respond', postId, offerId, artistWallet, decision, timestamp, signature }
 */

import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { getLatestPin, savePin } from '../../lib/pinataStore';
import { getRegistryArts } from './registry';
import { buildProposeOfferMessage, buildRespondOfferMessage } from '../../lib/offerSignature';

export const OFFERS_REGISTRY_NAME = 'urban-secure-offers-v1';
const COLLECT_WINDOW_MS = 24 * 60 * 60 * 1000;
const OFFER_WINDOW_MS = 24 * 60 * 60 * 1000;
const COLLECT_TIERS = [5, 10, 20, 50];

const SOLANA_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SIGNATURE_WINDOW_MS = 10 * 60 * 1000;

export async function getOffers(jwt) {
  const offers = await getLatestPin(jwt, OFFERS_REGISTRY_NAME, {});
  return (offers && typeof offers === 'object') ? offers : {};
}

export async function saveOffers(jwt, offers) {
  return savePin(jwt, OFFERS_REGISTRY_NAME, offers);
}

function computeStatus(offer) {
  if (offer.status === 'pending' && Date.now() - offer.createdAt > OFFER_WINDOW_MS) return 'expired';
  return offer.status;
}

function verifySignature(message, signature, walletB58) {
  try {
    const sigBytes = Buffer.from(signature, 'base64');
    if (sigBytes.length !== 64) return false;
    const pubkeyBytes = bs58.decode(walletB58);
    if (pubkeyBytes.length !== 32) return false;
    const msgBytes = new TextEncoder().encode(message);
    return nacl.sign.detached.verify(msgBytes, sigBytes, pubkeyBytes);
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    return await handleOffers(req, res);
  } catch (err) {
    console.error('[/api/offers FATAL]', err?.message);
    return res.status(500).json({ error: 'Erro no servidor.' });
  }
}

async function handleOffers(req, res) {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) return res.status(500).json({ error: 'PINATA_JWT ausente no ambiente da função.' });

  if (req.method === 'GET') {
    const { postId } = req.query;
    if (!postId || !SOLANA_ADDR_RE.test(postId)) return res.status(400).json({ error: 'postId inválido.' });
    const offers = await getOffers(jwt);
    const list = (offers[postId] || []).map(o => ({ ...o, status: computeStatus(o) }));
    res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=60');
    return res.status(200).json({ offers: list });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action } = req.body || {};

  if (action === 'propose') {
    const { postId, buyerWallet, tier: tierRaw, timestamp, signature } = req.body || {};
    const tier = Number(tierRaw);

    if (!SOLANA_ADDR_RE.test(postId))      return res.status(400).json({ error: 'postId inválido.' });
    if (!SOLANA_ADDR_RE.test(buyerWallet)) return res.status(400).json({ error: 'buyerWallet inválida.' });
    if (!COLLECT_TIERS.includes(tier))     return res.status(400).json({ error: 'Tier inválido.' });
    if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > SIGNATURE_WINDOW_MS) {
      return res.status(400).json({ error: 'Timestamp inválido ou expirado. Tente novamente.' });
    }
    if (typeof signature !== 'string' || !signature) return res.status(401).json({ error: 'Assinatura ausente.' });

    const message = buildProposeOfferMessage({ postId, buyerWallet, tier, timestamp });
    if (!verifySignature(message, signature, buyerWallet)) {
      return res.status(401).json({ error: 'Assinatura inválida — a carteira não confirmou esta proposta.' });
    }

    const arts = await getRegistryArts(jwt);
    const art = arts.find(a => a.id === postId);
    if (!art) return res.status(404).json({ error: 'Obra não encontrada no registro.' });
    if (buyerWallet === art.artistWallet) return res.status(403).json({ error: 'O artista não pode propor lance na própria obra.' });
    if (Date.now() - art.timestamp <= COLLECT_WINDOW_MS) {
      return res.status(409).json({ error: 'Lances só ficam disponíveis depois que a coleta padrão de 24h expira.' });
    }

    const offers = await getOffers(jwt);
    const list = offers[postId] || [];

    const hasActive = list.some(o => o.buyerWallet === buyerWallet && computeStatus(o) === 'pending');
    if (hasActive) return res.status(409).json({ error: 'Você já tem uma proposta pendente nesta obra.' });

    const offer = {
      id: `${buyerWallet}-${timestamp}`,
      buyerWallet,
      tier,
      status: 'pending',
      createdAt: Date.now(),
      respondedAt: null,
    };
    list.push(offer);
    offers[postId] = list;

    const saved = await saveOffers(jwt, offers);
    if (!saved) return res.status(502).json({ error: 'Falha ao salvar proposta.' });

    return res.status(200).json({ ok: true, offer });
  }

  if (action === 'respond') {
    const { postId, offerId, artistWallet, decision, timestamp, signature } = req.body || {};

    if (!SOLANA_ADDR_RE.test(postId))       return res.status(400).json({ error: 'postId inválido.' });
    if (!SOLANA_ADDR_RE.test(artistWallet)) return res.status(400).json({ error: 'artistWallet inválida.' });
    if (decision !== 'accept' && decision !== 'reject') return res.status(400).json({ error: 'Decisão inválida.' });
    if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > SIGNATURE_WINDOW_MS) {
      return res.status(400).json({ error: 'Timestamp inválido ou expirado. Tente novamente.' });
    }
    if (typeof signature !== 'string' || !signature) return res.status(401).json({ error: 'Assinatura ausente.' });

    const message = buildRespondOfferMessage({ postId, offerId, artistWallet, decision, timestamp });
    if (!verifySignature(message, signature, artistWallet)) {
      return res.status(401).json({ error: 'Assinatura inválida — a carteira não confirmou esta resposta.' });
    }

    const arts = await getRegistryArts(jwt);
    const art = arts.find(a => a.id === postId);
    if (!art) return res.status(404).json({ error: 'Obra não encontrada no registro.' });
    if (art.artistWallet !== artistWallet) return res.status(403).json({ error: 'Só o dono da obra pode responder propostas dela.' });

    const offers = await getOffers(jwt);
    const list = offers[postId] || [];
    const offer = list.find(o => o.id === offerId);
    if (!offer) return res.status(404).json({ error: 'Proposta não encontrada.' });
    if (computeStatus(offer) !== 'pending') {
      return res.status(409).json({ error: 'Esta proposta já não está mais pendente.' });
    }

    offer.status = decision === 'accept' ? 'accepted' : 'rejected';
    offer.respondedAt = Date.now();
    offers[postId] = list;

    const saved = await saveOffers(jwt, offers);
    if (!saved) return res.status(502).json({ error: 'Falha ao salvar resposta.' });

    return res.status(200).json({ ok: true, offer });
  }

  return res.status(400).json({ error: 'Ação inválida.' });
}

export const config = {
  maxDuration: 15,
};
