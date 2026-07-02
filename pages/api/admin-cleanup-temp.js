/**
 * pages/api/admin-cleanup-temp.js
 * ENDPOINT TEMPORÁRIO — remove os dados de teste (QA-OFFER) que ficaram no
 * Pinata compartilhado durante o QA do fluxo de proposta/aceite de lances.
 * Protegido por token de uso único. Remover este arquivo depois de rodar.
 */
import { getLatestPin, savePin } from '../../lib/pinataStore';

const TOKEN = 'qa-offer-cleanup-20260702-r4sjunior';
const TEST_ART_IDS = new Set([
  '3XvzALJoNs7ZXbDTtdzbdgGiKY3Rd6j3EXq7tDNu25d7', // QA-OFFER
]);

export default async function handler(req, res) {
  if (req.query.token !== TOKEN) return res.status(403).json({ error: 'forbidden' });
  const jwt = process.env.PINATA_JWT;
  if (!jwt) return res.status(500).json({ error: 'PINATA_JWT ausente.' });

  const report = {};

  const arts = await getLatestPin(jwt, 'urban-secure-registry-v1', []);
  const keptArts = (Array.isArray(arts) ? arts : []).filter(a => !TEST_ART_IDS.has(a.id));
  report.registryBefore = arts.length;
  report.registryAfter = keptArts.length;
  report.registrySaved = await savePin(jwt, 'urban-secure-registry-v1', keptArts);

  const likes = await getLatestPin(jwt, 'urban-secure-likes-v1', {});
  const keptLikes = { ...likes };
  for (const id of TEST_ART_IDS) delete keptLikes[id];
  report.likesRemoved = Object.keys(likes || {}).length - Object.keys(keptLikes).length;
  report.likesSaved = await savePin(jwt, 'urban-secure-likes-v1', keptLikes);

  const collects = await getLatestPin(jwt, 'urban-secure-collects-v1', {});
  const keptCollects = { ...collects };
  for (const id of TEST_ART_IDS) delete keptCollects[id];
  report.collectsRemoved = Object.keys(collects || {}).length - Object.keys(keptCollects).length;
  report.collectsSaved = await savePin(jwt, 'urban-secure-collects-v1', keptCollects);

  const offers = await getLatestPin(jwt, 'urban-secure-offers-v1', {});
  const keptOffers = { ...offers };
  for (const id of TEST_ART_IDS) delete keptOffers[id];
  report.offersRemoved = Object.keys(offers || {}).length - Object.keys(keptOffers).length;
  report.offersSaved = await savePin(jwt, 'urban-secure-offers-v1', keptOffers);

  return res.status(200).json({ ok: true, report });
}

export const config = { maxDuration: 30 };
