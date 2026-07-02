/**
 * pages/api/vault.js
 * Endereço público da vault custodial do marketplace — o cliente precisa
 * dele pra transferir o NFT no momento de anunciar uma venda.
 * GET → { address }
 */
import { getVaultAddress } from '../../lib/vaultSigner';

export default async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    return res.status(200).json({ address: getVaultAddress() });
  } catch (err) {
    console.error('[/api/vault]', err.message);
    return res.status(500).json({ error: 'Vault do marketplace não configurada no servidor.' });
  }
}
