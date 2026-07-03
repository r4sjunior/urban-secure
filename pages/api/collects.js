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
 *  - Depois de 24h, a coleta padrão fecha e os lances (5x/10x/20x/50x) só
 *    podem ser pagos/mintados se existir uma PROPOSTA ACEITA (ver
 *    /api/offers) daquela wallet, naquele tier, pra essa obra — proposta é
 *    feita e aceita/recusada pelo dono da obra antes de qualquer dinheiro
 *    trocar de mãos.
 *  - O artista não pode coletar a própria obra.
 *  - O pagamento precisa existir on-chain, ser assinado pela wallet que está
 *    coletando, e pagar pelo menos o preço do tier escolhido para o artista.
 *  - Sem limite de coletas por wallet (pode coletar a mesma obra várias vezes,
 *    cada tier > 1 exige uma nova proposta aceita).
 */

import { getLatestPin, mutatePin, MutationAbort } from '../../lib/pinataStore';
import { getRegistryArts } from './registry';
import { getOffers, OFFERS_REGISTRY_NAME } from './offers';

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
        return res.status(409).json({ error: 'Janela de coleta padrão expirada — proponha um lance (5x/10x/20x/50x).' });
      }
      if (tier !== 1 && !expired) {
        return res.status(409).json({ error: 'Lances só ficam disponíveis depois que a coleta padrão de 24h expira.' });
      }

      // Lance (tier > 1) exige uma proposta aceita pelo dono da obra pra
      // essa wallet+tier — nunca aceito sem essa aprovação prévia.
      // Checagem rápida (não atômica) só pra falhar cedo antes de gastar
      // uma chamada RPC — a validação que realmente vale é a atômica logo
      // abaixo, feita dentro de mutatePin.
      let offerId;
      if (tier !== 1) {
        const offers = await getOffers(jwt);
        const offerList = offers[postId] || [];
        const matchedOffer = offerList.find(o => o.buyerWallet === wallet && o.tier === tier && o.status === 'accepted');
        if (!matchedOffer) {
          return res.status(403).json({ error: 'Não há proposta aceita pelo dono da obra pra essa wallet e tier. Proponha um lance e aguarde a aprovação.' });
        }
        offerId = matchedOffer.id;
      }

      const network = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet';

      const verification = await verifyCollectPayment({ tx, wallet, artistWallet: art.artistWallet, network, tier });
      if (!verification.ok) {
        return res.status(402).json({ error: `Pagamento não confirmado: ${verification.reason}` });
      }

      // Consome a proposta aceita ANTES de registrar a coleta — atômico via
      // mutatePin, então duas requisições concorrentes usando o mesmo aceite
      // não conseguem registrar duas coletas (a segunda vê a proposta já
      // 'completed' e é rejeitada, mesmo que ambas tenham lido 'accepted'
      // no início da função).
      if (tier !== 1) {
        const offerMutation = await mutatePin(jwt, OFFERS_REGISTRY_NAME, {}, (raw) => {
          const offers = (raw && typeof raw === 'object') ? raw : {};
          const list = offers[postId] || [];
          const idx = list.findIndex(o => o.id === offerId);
          if (idx === -1 || list[idx].status !== 'accepted') {
            throw new MutationAbort({ status: 409, error: 'Esta proposta aceita já foi usada em outra coleta.' });
          }
          const updated = { ...list[idx], status: 'completed' };
          const newList = [...list.slice(0, idx), updated, ...list.slice(idx + 1)];
          const data = { ...offers, [postId]: newList };
          return { data, result: updated };
        });

        if (!offerMutation.ok) {
          if (offerMutation.aborted) return res.status(offerMutation.payload.status).json({ error: offerMutation.payload.error });
          return res.status(502).json({ error: 'Falha ao consumir a proposta aceita.' });
        }
      }

      const collectMutation = await mutatePin(jwt, COLLECTS_REGISTRY_NAME, {}, (raw) => {
        const collects = (raw && typeof raw === 'object') ? raw : {};
        const list = collects[postId] || [];

        const txReused = Object.values(collects).some(arr => arr.some(c => c.tx === tx));
        if (txReused) {
          throw new MutationAbort({ status: 409, error: 'Esta transação já foi usada para registrar uma coleta.' });
        }

        const newList = [...list, { wallet, tx, editionMintId, tier, timestamp: Date.now() }];
        const data = { ...collects, [postId]: newList };
        return { data, result: { count: newList.length } };
      });

      if (!collectMutation.ok) {
        if (collectMutation.aborted) return res.status(collectMutation.payload.status).json({ error: collectMutation.payload.error });
        return res.status(502).json({ error: 'Falha ao salvar coleta.' });
      }

      return res.status(200).json({ ok: true, count: collectMutation.result.count });
    } catch (err) {
      console.error('[/api/collects POST]', err.message);
      return res.status(500).json({ error: 'Erro ao registrar coleta.' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export const config = {
  maxDuration: 30,
};
