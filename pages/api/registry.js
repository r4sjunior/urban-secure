/**
 * pages/api/registry.js
 * Registro próprio de artes (contorna falta de indexação na devnet).
 * GET  → lista as artes registradas
 * POST → adiciona uma arte ao índice (valida formato e propriedade do NFT)
 */

import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { buildRegistryMessage } from '../../lib/registrySignature';
import { getLatestPin, savePin } from '../../lib/pinataStore';
import { sanitize } from '../../lib/sanitize';

export const REGISTRY_NAME  = 'urban-secure-registry-v1';
const SOLANA_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// Janela de tolerância para o timestamp assinado — evita reuso de assinaturas antigas
const SIGNATURE_WINDOW_MS = 10 * 60 * 1000;

// Verifica que quem está registrando é o dono real da wallet `artistWallet`:
// a assinatura precisa corresponder à mensagem (id + wallet + timestamp) assinada no cliente.
function verifyArtistSignature({ id, artistWallet, timestamp, signature }) {
  try {
    const sigBytes = Buffer.from(signature, 'base64');
    if (sigBytes.length !== 64) return false;
    const pubkeyBytes = bs58.decode(artistWallet);
    if (pubkeyBytes.length !== 32) return false;
    const message = buildRegistryMessage({ id, artistWallet, timestamp });
    const msgBytes = new TextEncoder().encode(message);
    return nacl.sign.detached.verify(msgBytes, sigBytes, pubkeyBytes);
  } catch {
    return false;
  }
}

export async function getRegistryArts(jwt) {
  const arts = await getLatestPin(jwt, REGISTRY_NAME, []);
  return Array.isArray(arts) ? arts : [];
}

/**
 * Verifica via Helius DAS que o NFT pertence à wallet declarada.
 * Só usado em mainnet onde o DAS indexa os assets.
 */
async function verifyNftOwnership(mintId, ownerWallet) {
  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) return true; // sem chave, aceita (best-effort)
  try {
    const r = await fetch(`https://mainnet.helius-rpc.com/?api-key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAsset', params: { id: mintId } }),
    });
    if (!r.ok) return true; // falha de API — aceita
    const data = await r.json();
    const owner = data?.result?.ownership?.owner;
    // Se DAS não retornar owner, aceita (NFT pode não estar indexado ainda)
    if (!owner) return true;
    return owner === ownerWallet;
  } catch {
    return true; // falha de rede — aceita
  }
}

export default async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const jwt = process.env.PINATA_JWT;
  if (!jwt) return res.status(500).json({ error: 'Servidor não configurado.' });

  if (req.method === 'GET') {
    const arts = await getRegistryArts(jwt);
    res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=120');
    return res.status(200).json({ arts, total: arts.length });
  }

  if (req.method === 'POST') {
    try {
      const body = req.body;

      // Valida formatos de endereço Solana
      if (!body?.id || !SOLANA_ADDR_RE.test(body.id)) {
        return res.status(400).json({ error: 'ID de mint inválido.' });
      }
      if (!body?.artistWallet || !SOLANA_ADDR_RE.test(body.artistWallet)) {
        return res.status(400).json({ error: 'Endereço de artista inválido.' });
      }

      // Timestamp assinado — precisa ser numérico e recente (evita replay de assinaturas antigas)
      const timestamp = body.timestamp;
      if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > SIGNATURE_WINDOW_MS) {
        return res.status(400).json({ error: 'Timestamp inválido ou expirado. Tente registrar novamente.' });
      }

      // Assinatura da wallet do artista — prova que quem está registrando é o dono da carteira
      if (typeof body.signature !== 'string' || !body.signature) {
        return res.status(401).json({ error: 'Assinatura da carteira ausente.' });
      }
      if (!verifyArtistSignature({ id: body.id, artistWallet: body.artistWallet, timestamp, signature: body.signature })) {
        return res.status(401).json({ error: 'Assinatura inválida — a carteira não confirmou este registro.' });
      }

      // Valida coordenadas GPS com faixas realistas
      const lat = parseFloat(body.lat);
      const lng = parseFloat(body.lng);
      if (isNaN(lat) || lat < -90  || lat > 90)  return res.status(400).json({ error: 'Latitude inválida.' });
      if (isNaN(lng) || lng < -180 || lng > 180) return res.status(400).json({ error: 'Longitude inválida.' });

      // Valida URL da imagem: só aceita gateway oficial do Pinata
      const rawUrl = typeof body.imageUrl === 'string' ? body.imageUrl : '';
      const imageUrl = rawUrl.startsWith('https://gateway.pinata.cloud/ipfs/') ? rawUrl : '';

      // Constrói objeto sanitizado — nunca persiste campos extras do body
      const safeArt = {
        id:           body.id,
        name:         sanitize(body.name,        200),
        artistName:   sanitize(body.artistName,  100),
        description:  sanitize(body.description, 500),
        lat,
        lng,
        imageUrl,
        artistWallet: body.artistWallet,
        timestamp,
      };

      // Em mainnet, verifica que o NFT pertence à wallet declarada
      const network = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet';
      if (network === 'mainnet-beta') {
        const owned = await verifyNftOwnership(safeArt.id, safeArt.artistWallet);
        if (!owned) {
          return res.status(403).json({ error: 'NFT não encontrado ou não pertence a esta carteira.' });
        }
      }

      const arts = await getRegistryArts(jwt);
      if (!arts.find(a => a.id === safeArt.id)) arts.push(safeArt);

      const saved = await savePin(jwt, REGISTRY_NAME, arts);
      if (!saved) {
        console.error('[registry POST] falha ao salvar pin');
        return res.status(502).json({ error: 'Falha ao registrar.' });
      }
      return res.status(200).json({ ok: true, total: arts.length });
    } catch (err) {
      console.error('[registry POST]', err.message);
      return res.status(500).json({ error: 'Erro ao registrar.' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
