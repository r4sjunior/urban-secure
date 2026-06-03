/**
 * pages/api/rpc.js
 * Proxy RPC da Solana via Helius — mint confiável.
 * HELIUS_API_KEY fica no servidor.
 */

export default async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey  = process.env.HELIUS_API_KEY;
  const network = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet';
  if (!apiKey) return res.status(500).json({ error: 'RPC não configurado.' });

  const cluster = network === 'mainnet-beta' ? 'mainnet' : 'devnet';
  const url     = `https://${cluster}.helius-rpc.com/?api-key=${apiKey}`;

  try {
    const heliusRes = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(req.body),
    });

    const text = await heliusRes.text();

    // Se o Helius retornar erro de auth/limite, loga para diagnóstico
    if (!heliusRes.ok) {
      console.error('[/api/rpc] Helius status', heliusRes.status, text.slice(0, 200));
    }

    // Repassa a resposta crua (JSON-RPC) com o mesmo status
    res.setHeader('Content-Type', 'application/json');
    return res.status(heliusRes.status).send(text);
  } catch (err) {
    console.error('[/api/rpc]', err.message);
    return res.status(500).json({ error: 'Erro no RPC.' });
  }
}
