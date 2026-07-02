/**
 * pages/api/listings.js
 * Mercado de revenda — quem detém um NFT URBAN (a obra original mintada
 * pelo artista, ou uma edição coletada) pode anunciar pra venda. O NFT fica
 * custodiado na vault do servidor (lib/vaultSigner.js) enquanto o anúncio
 * está ativo, e é liberado pro comprador quando o pagamento é confirmado
 * on-chain — ou devolvido ao vendedor se ele cancelar.
 *
 * GET                                              → anúncios ativos
 * POST { action:'list',   mint, seller, price, name, imageUrl }
 * POST { action:'buy',    mint, buyer, tx }
 * POST { action:'cancel', mint, seller, timestamp, signature }
 */

import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { getLatestPin, savePin } from '../../lib/pinataStore';
import { verifyVaultHoldsMint, transferFromVault } from '../../lib/vaultSigner';
import { buildDelistMessage } from '../../lib/listingSignature';
import { sanitize } from '../../lib/sanitize';

const LISTINGS_REGISTRY_NAME = 'urban-secure-listings-v1';
const SOLANA_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SOLANA_TX_RE   = /^[1-9A-HJ-NP-Za-km-z]{86,90}$/;
const SIGNATURE_WINDOW_MS = 10 * 60 * 1000;
const MAX_PRICE_SOL = 100000;

async function getListings(jwt) {
  const listings = await getLatestPin(jwt, LISTINGS_REGISTRY_NAME, {});
  return (listings && typeof listings === 'object') ? listings : {};
}

function verifySellerSignature({ mint, seller, timestamp, signature }) {
  try {
    const sigBytes = Buffer.from(signature, 'base64');
    if (sigBytes.length !== 64) return false;
    const pubkeyBytes = bs58.decode(seller);
    if (pubkeyBytes.length !== 32) return false;
    const message = buildDelistMessage({ mint, seller, timestamp });
    const msgBytes = new TextEncoder().encode(message);
    return nacl.sign.detached.verify(msgBytes, sigBytes, pubkeyBytes);
  } catch {
    return false;
  }
}

/**
 * Verifica que a transação de compra existe on-chain, foi assinada pelo
 * comprador, e pagou o vendedor pelo menos o preço do anúncio.
 */
async function verifyBuyPayment({ tx, buyer, seller, priceLamports }) {
  const apiKey = process.env.HELIUS_API_KEY;
  const network = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet';
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

  const msg = parsed.transaction?.message;
  const instructions = msg?.instructions || [];
  const accountKeys  = msg?.accountKeys  || [];
  const signer = accountKeys.find(k => k.signer)?.pubkey;
  if (signer !== buyer) return { ok: false, reason: 'Assinante da transação não corresponde ao comprador.' };

  let paidSeller = 0;
  for (const ix of instructions) {
    if (ix.program !== 'system' || ix.parsed?.type !== 'transfer') continue;
    const info = ix.parsed.info;
    if (info.source !== buyer) continue;
    if (info.destination === seller) paidSeller += Number(info.lamports);
  }

  const TOL = 50;
  if (paidSeller + TOL < priceLamports) {
    return { ok: false, reason: `Pagamento ao vendedor insuficiente (${paidSeller} < ${priceLamports} lamports).` };
  }

  return { ok: true };
}

export default async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    return await handleListings(req, res);
  } catch (err) {
    console.error('[/api/listings FATAL]', err?.message);
    return res.status(500).json({ error: 'Erro no servidor.' });
  }
}

async function handleListings(req, res) {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) return res.status(500).json({ error: 'PINATA_JWT ausente no ambiente da função.' });

  if (req.method === 'GET') {
    const listings = await getListings(jwt);
    res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=60');
    return res.status(200).json({ listings: Object.values(listings) });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action } = req.body || {};

  if (action === 'list') {
    const { mint, seller, price, name, imageUrl } = req.body || {};
    if (!SOLANA_ADDR_RE.test(mint))   return res.status(400).json({ error: 'mint inválido.' });
    if (!SOLANA_ADDR_RE.test(seller)) return res.status(400).json({ error: 'seller inválido.' });

    const priceNum = parseFloat(price);
    if (!Number.isFinite(priceNum) || priceNum <= 0 || priceNum > MAX_PRICE_SOL) {
      return res.status(400).json({ error: 'Preço inválido.' });
    }

    // O RPC pode demorar um pouco pra refletir a transferência que acabou de
    // confirmar (lag de indexação) — tenta algumas vezes antes de desistir.
    let holds = false;
    for (let i = 0; i < 5 && !holds; i++) {
      if (i > 0) await new Promise(r => setTimeout(r, 1500));
      holds = await verifyVaultHoldsMint(mint);
    }
    if (!holds) {
      return res.status(402).json({ error: 'O NFT ainda não chegou na vault. Aguarde a confirmação da transferência e tente novamente.' });
    }

    const listings = await getListings(jwt);
    listings[mint] = {
      mint,
      seller,
      price: priceNum,
      name: sanitize(name, 200),
      imageUrl: (typeof imageUrl === 'string' && imageUrl.startsWith('https://gateway.pinata.cloud/ipfs/')) ? imageUrl : '',
      listedAt: Date.now(),
    };

    const saved = await savePin(jwt, LISTINGS_REGISTRY_NAME, listings);
    if (!saved) return res.status(502).json({ error: 'Falha ao salvar anúncio.' });
    return res.status(200).json({ ok: true });
  }

  if (action === 'buy') {
    const { mint, buyer, tx } = req.body || {};
    if (!SOLANA_ADDR_RE.test(mint))  return res.status(400).json({ error: 'mint inválido.' });
    if (!SOLANA_ADDR_RE.test(buyer)) return res.status(400).json({ error: 'buyer inválido.' });
    if (!SOLANA_TX_RE.test(tx))      return res.status(400).json({ error: 'Assinatura de transação inválida.' });

    const listings = await getListings(jwt);
    const listing = listings[mint];
    if (!listing) return res.status(404).json({ error: 'Anúncio não encontrado — pode já ter sido vendido ou cancelado.' });
    if (listing.seller === buyer) return res.status(403).json({ error: 'Você não pode comprar seu próprio anúncio.' });

    const priceLamports = Math.round(listing.price * 1e9);
    const verification = await verifyBuyPayment({ tx, buyer, seller: listing.seller, priceLamports });
    if (!verification.ok) return res.status(402).json({ error: `Pagamento não confirmado: ${verification.reason}` });

    delete listings[mint];
    const saved = await savePin(jwt, LISTINGS_REGISTRY_NAME, listings);
    if (!saved) return res.status(502).json({ error: 'Falha ao atualizar anúncios.' });

    try {
      await transferFromVault({ mint, toWallet: buyer });
    } catch (err) {
      console.error('[/api/listings buy] transferência da vault falhou', err.message);
      return res.status(500).json({ error: 'Pagamento confirmado, mas a transferência do NFT falhou. Seu pagamento está registrado — tente recarregar em instantes ou contate o suporte.' });
    }

    return res.status(200).json({ ok: true });
  }

  if (action === 'cancel') {
    const { mint, seller, timestamp, signature } = req.body || {};
    if (!SOLANA_ADDR_RE.test(mint))   return res.status(400).json({ error: 'mint inválido.' });
    if (!SOLANA_ADDR_RE.test(seller)) return res.status(400).json({ error: 'seller inválido.' });
    if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > SIGNATURE_WINDOW_MS) {
      return res.status(400).json({ error: 'Timestamp inválido ou expirado. Tente novamente.' });
    }
    if (typeof signature !== 'string' || !signature) return res.status(401).json({ error: 'Assinatura ausente.' });

    const listings = await getListings(jwt);
    const listing = listings[mint];
    if (!listing) return res.status(404).json({ error: 'Anúncio não encontrado.' });
    if (listing.seller !== seller) return res.status(403).json({ error: 'Esta wallet não é a vendedora deste anúncio.' });
    if (!verifySellerSignature({ mint, seller, timestamp, signature })) {
      return res.status(401).json({ error: 'Assinatura inválida — a carteira não confirmou este cancelamento.' });
    }

    delete listings[mint];
    const saved = await savePin(jwt, LISTINGS_REGISTRY_NAME, listings);
    if (!saved) return res.status(502).json({ error: 'Falha ao atualizar anúncios.' });

    try {
      await transferFromVault({ mint, toWallet: seller });
    } catch (err) {
      console.error('[/api/listings cancel] devolução da vault falhou', err.message);
      return res.status(500).json({ error: 'Anúncio cancelado, mas a devolução do NFT falhou. Tente novamente ou contate o suporte.' });
    }

    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: 'Ação inválida.' });
}

export const config = {
  maxDuration: 45,
};
