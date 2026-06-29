/**
 * pages/api/rpc.js
 * Proxy RPC da Solana via Helius — mint confiável.
 * HELIUS_API_KEY fica no servidor.
 * Apenas métodos da allowlist são encaminhados ao Helius.
 */

export const config = {
  api: { bodyParser: { sizeLimit: '4mb' } },
};

// Métodos Solana RPC padrão + Helius DAS usados pelo app (Metaplex UMI, likePayment, TransferModal)
const ALLOWED_METHODS = new Set([
  // Blockhash / confirmação
  'getLatestBlockhash', 'getRecentBlockhash', 'isBlockhashValid',
  'getBlockHeight', 'getBlockTime', 'getSlot', 'getEpochInfo', 'getVersion',
  // Envio e simulação
  'sendTransaction', 'simulateTransaction',
  // Consulta de transações e assinaturas
  'getTransaction', 'getSignatureStatuses', 'getSignatureStatus',
  'getConfirmedSignaturesForAddress2', 'getSignaturesForAddress',
  // Contas e tokens
  'getAccountInfo', 'getMultipleAccounts', 'getProgramAccounts',
  'getBalance', 'getMinimumBalanceForRentExemption', 'getFeeForMessage',
  'getTokenAccountsByOwner', 'getTokenAccountsByDelegate',
  'getTokenAccountBalance', 'getTokenSupply', 'getTokenLargestAccounts',
  // Outros padrão
  'getRecentPrioritizationFees', 'getRecentPerformanceSamples',
  'requestAirdrop',
  // Helius DAS — usados pelo Metaplex UMI para buscar/verificar assets
  'getAsset', 'getAssets', 'getAssetProof',
  'getAssetsByOwner', 'getAssetsByGroup', 'getAssetsByCreator', 'getAssetsByAuthority',
  'searchAssets', 'getAssetBatch', 'getSignaturesForAsset',
]);

export default async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey  = process.env.HELIUS_API_KEY;
  const network = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet';
  if (!apiKey) return res.status(500).json({ error: 'RPC não configurado.' });

  // Extrai e valida o método antes de encaminhar
  let bodyObj;
  try {
    bodyObj = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'Body inválido.' });
  }

  const method = bodyObj?.method;
  if (typeof method !== 'string' || !ALLOWED_METHODS.has(method)) {
    console.warn('[/api/rpc] método bloqueado:', method);
    return res.status(403).json({ error: 'Método RPC não permitido.' });
  }

  const cluster = network === 'mainnet-beta' ? 'mainnet' : 'devnet';
  const url     = `https://${cluster}.helius-rpc.com/?api-key=${apiKey}`;

  try {
    const heliusRes = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(bodyObj),
    });

    const text = await heliusRes.text();
    if (!heliusRes.ok) {
      console.error('[/api/rpc] Helius', heliusRes.status, text.slice(0, 200));
    }

    res.setHeader('Content-Type', 'application/json');
    return res.status(heliusRes.status).send(text);
  } catch (err) {
    console.error('[/api/rpc]', err.message);
    return res.status(500).json({ error: 'Erro no RPC.' });
  }
}
