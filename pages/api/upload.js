/**
 * pages/api/upload.js
 *
 * Proxy server-side para o Pinata.
 * O JWT nunca sai do servidor — usuários não conseguem ver ou abusar.
 *
 * POST /api/upload
 *   Body: FormData com campo "file" (imagem) OU campo "json" (metadados)
 *   Returns: { url: "https://gateway.pinata.cloud/ipfs/..." }
 */

export const config = {
  api: {
    bodyParser: false, // necessário para receber FormData/binário
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // JWT fica SOMENTE no servidor — sem NEXT_PUBLIC_
  const jwt = process.env.PINATA_JWT;
  if (!jwt) {
    return res.status(500).json({ error: 'PINATA_JWT não configurado no servidor.' });
  }

  try {
    const contentType = req.headers['content-type'] || '';

    // ── Upload de arquivo (imagem) ─────────────────────────
    if (contentType.includes('multipart/form-data')) {
      // Repassa o stream diretamente ao Pinata
      const pinataRes = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
        method:  'POST',
        headers: {
          Authorization: `Bearer ${jwt}`,
          // NÃO define Content-Type — o fetch preserva o boundary do multipart
        },
        body: req, // stream direto
      });

      if (!pinataRes.ok) {
        const err = await pinataRes.text();
        return res.status(502).json({ error: `Pinata error: ${err}` });
      }

      const { IpfsHash } = await pinataRes.json();
      return res.status(200).json({
        url: `https://gateway.pinata.cloud/ipfs/${IpfsHash}`,
      });
    }

    // ── Upload de JSON (metadados) ─────────────────────────
    if (contentType.includes('application/json')) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString();
      const json = JSON.parse(body);

      const pinataRes = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
        method:  'POST',
        headers: {
          Authorization:  `Bearer ${jwt}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ pinataContent: json }),
      });

      if (!pinataRes.ok) {
        const err = await pinataRes.text();
        return res.status(502).json({ error: `Pinata error: ${err}` });
      }

      const { IpfsHash } = await pinataRes.json();
      return res.status(200).json({
        url: `https://gateway.pinata.cloud/ipfs/${IpfsHash}`,
      });
    }

    return res.status(400).json({ error: 'Content-Type não suportado.' });

  } catch (err) {
    console.error('[/api/upload]', err);
    return res.status(500).json({ error: err.message });
  }
}
