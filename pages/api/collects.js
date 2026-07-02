/**
 * pages/api/collects.js
 * Registro de "coletas" (mint de edição pago) — Pinata/IPFS.
 * GET  ?postId=...                     → contagem de coletas de uma obra
 * POST { postId, wallet, tx, editionMintId, tier } → registra coleta (após
 *       pagamento confirmado on-chain e mint da edição confirmado pelo cliente)
 *
 * Regras (nunca confiar no client):
 *  - Nas primeiras 24h depois do registro da obra, só a coleta padrão (tier=1)
 *    é aceita, pelo preço base.
 *  - Depois de 24h, a coleta padrão fecha e só lances nos múltiplos fixos de
 *    COLLECT_TIERS (5x/10x/20x/50x do preço base) são aceitos — sem prazo
 *    final: é compra instantânea no valor do tier, não leilão com vencedor.
 *  - O artista não pode coletar a própria obra.
 *  - O pagamento precisa existir on-chain, ser assinado pela wallet que está
 *    coletando, e pagar pelo menos o preço do tier escolhido para o artista.
 *  - Sem limite de coletas por wallet (pode coletar a mesma obra várias vezes).
 */

import { getLatestPin, savePin } from '../../lib/pinataStore';
import { getRegistryArts } from './registry';

const COLLECTS_REGISTRY_NAME = 'urban-secure-collects-v1';
const COLLECT_WINDOW_MS = 24 * 60 * 60 * 1000;
const COLLECT_TIERS = [5, 10, 20, 50];

const SOLANA_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SOLANA_TX_RE   = /^[1-9A-HJ-NP-Za-km-z]{86,90}$/;

async function getLatestCollects(jwt) {
  const collects = await getLatestPin(jwt, COLLECTS_REGISTRY_NAME, {});
  return (collects && typeof collects === 'object') ? collects : {};
}

/**
 * Verifica que a transação existe on-chain, foi assinada pela wallet correta,
 * e pagou o artista o valor esperado da coleta.
 */
async function verifyCollectPayment({ tx, wallet, artistWallet, network, tier }) {
  const apiKey = process.env.HELIUS_API_KEY;
  const cluster = network === 'mainnet-beta' ? 'mainnet' : 'devnet';
  const rpcUrl = apiKey
    ? `https://${cluster}.helius-rpc.com/?api-key=${apiKey}`
    : (cluster === 'mainnet' ? 'https://api.mainnet-beta.solana.com' : 'https://api.devnet.solana.com');

  let parsed;
  try {
    const r = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getTransaction',
        params: [tx, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }],
      }),
    });
    const json = await r.json();
    parsed = json?.result;
  } catch {
    return { ok: false, reason: 'Erro ao verificar pagamento. Tente novamente em instantes.' };
  }

  if (!parsed) {
    return { ok: false, reason: 'Transação não encontrada on-chain. Aguarde a confirmação e tente novamente.' };
  }
  if (parsed.meta?.err) return { ok: false, reason: 'Transação falhou on-chain.' };

  const priceLamports = Math.round(parseFloat(process.env.NEXT_PUBLIC_COLLECT_PRICE_SOL || '0.0012') * 1e9 * tier);

  const msg = parsed.transaction?.message;
  const instructions = msg?.instructions || [];
  const accountKeys  = msg?.accountKeys  || [];
  const signer = accountKeys.find(k => k.signer)?.pubkey;
  if (signer !== wallet) return { ok: false, reason: 'Assinante da transação não corresponde à wallet.' };

  let paidArtist = 0;
  for (const ix of instructions) {
    if (ix.program !== 'system' || ix.parsed?.type !== 'transfer') continue;
    const info = ix.parsed.info;
    if (info.source !== wallet) continue;
    if (info.destination === artistWallet) paidArtist += Number(info.lamports);
  }

  const TOL = 50;
  if (paidArtist + TOL < priceLamports) {
    return { ok: false, reason: `Pagamento ao artista insuficiente (${paidArtist} < ${priceLamports} lamports).` };
  }

  return { ok: true };
}

export default async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    return await handleCollects(req, res);
  } catch (err) {
    console.error('[/api/collects FATAL]', err?.message);
    return res.status(500).json({ error: 'Erro no servidor.' });
  }
}

async function handleCollects(req, res) {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) return res.status(500).json({ error: 'PINATA_JWT ausente no ambiente da função.' });

  if (req.method === 'GET') {
    const { postId } = req.query;
    if (postId && !SOLANA_ADDR_RE.test(postId)) {
      return res.status(400).json({ error: 'postId inválido.' });
    }
    const collects = await getLatestCollects(jwt);

    if (postId) {
      const list = collects[postId] || [];
      return res.status(200).json({ count: list.length });
    }

    const counts = Object.fromEntries(Object.entries(collects).map(([k, v]) => [k, v.length]));
    res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=120');
    return res.status(200).json({ counts });
  }

  if (req.method === 'POST') {
    try {
      const { postId, wallet, tx, editionMintId } = req.body || {};
      const tier = Number(req.body?.tier ?? 1);

      if (!postId || !wallet || !tx || !editionMintId) {
        return res.status(400).json({ error: 'Dados inválidos.' });
      }
      if (!SOLANA_ADDR_RE.test(postId))        return res.status(400).json({ error: 'postId inválido.' });
      if (!SOLANA_ADDR_RE.test(wallet))        return res.status(400).json({ error: 'wallet inválida.' });
      if (!SOLANA_ADDR_RE.test(editionMintId)) return res.status(400).json({ error: 'editionMintId inválido.' });
      if (!SOLANA_TX_RE.test(tx))              return res.status(400).json({ error: 'Assinatura de transação inválida.' });
      if (tier !== 1 && !COLLECT_TIERS.includes(tier)) {
        return res.status(400).json({ error: 'Tier de lance inválido.' });
      }

      // Busca a obra original no índice oficial — nunca confia no artistWallet do client
      const arts = await getRegistryArts(jwt);
      const art = arts.find(a => a.id === postId);
      if (!art) return res.status(404).json({ error: 'Obra não encontrada no registro.' });

      if (wallet === art.artistWallet) {
        return res.status(403).json({ error: 'O artista não pode coletar a própria obra.' });
      }

      const expired = Date.now() - art.timestamp > COLLECT_WINDOW_MS;
      if (tier === 1 && expired) {
        return res.status(409).json({ error: 'Janela de coleta padrão expirada — escolha um lance (5x/10x/20x/50x).' });
      }
      if (tier !== 1 && !expired) {
        return res.status(409).json({ error: 'Lances só ficam disponíveis depois que a coleta padrão de 24h expira.' });
      }

      const network = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet';
      const collects = await getLatestCollects(jwt);
      const list = collects[postId] || [];

      const txReused = Object.values(collects).some(arr => arr.some(c => c.tx === tx));
      if (txReused) {
        return res.status(409).json({ error: 'Esta transação já foi usada para registrar uma coleta.' });
      }

      const verification = await verifyCollectPayment({ tx, wallet, artistWallet: art.artistWallet, network, tier });
      if (!verification.ok) {
        return res.status(402).json({ error: `Pagamento não confirmado: ${verification.reason}` });
      }

      list.push({ wallet, tx, editionMintId, tier, timestamp: Date.now() });
      collects[postId] = list;

      const saved = await savePin(jwt, COLLECTS_REGISTRY_NAME, collects);
      if (!saved) return res.status(502).json({ error: 'Falha ao salvar coleta.' });

      return res.status(200).json({ ok: true, count: list.length });
    } catch (err) {
      console.error('[/api/collects POST]', err.message);
      return res.status(500).json({ error: 'Erro ao registrar coleta.' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export const config = {
  maxDuration: 10,
};
