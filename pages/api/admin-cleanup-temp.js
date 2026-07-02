/**
 * pages/api/admin-cleanup-temp.js
 * ENDPOINT TEMPORÁRIO — remove os dados de teste (QA-TESTE/QA-TESTE2) que
 * ficaram no Pinata de produção durante o QA do feed/lances/mercado.
 * Protegido por token de uso único. Remover este arquivo depois de rodar.
 */
import { getLatestPin, savePin } from '../../lib/pinataStore';

const TOKEN = 'qa-cleanup-20260702-r4sjunior';
const TEST_ART_IDS = new Set([
  'E8rx6atzzPwxEwQpMS9cJMNYMB6TjaMNmUAKsytq15Qq', // QA-TESTE
  '68HBysMzg3GMJpcXKfT3vYtKewvUkmuqai1xCyxqd7Uc', // QA-TESTE2
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

  const listings = await getLatestPin(jwt, 'urban-secure-listings-v1', {});
  const keptListings = { ...listings };
  for (const id of TEST_ART_IDS) delete keptListings[id];
  report.listingsRemoved = Object.keys(listings || {}).length - Object.keys(keptListings).length;
  report.listingsSaved = await savePin(jwt, 'urban-secure-listings-v1', keptListings);

  return res.status(200).json({ ok: true, report });
}

export const config = { maxDuration: 30 };
