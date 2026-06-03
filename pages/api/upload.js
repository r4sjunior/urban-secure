/**
 * pages/api/upload.js
 * Proxy server-side para o Pinata — JWT nunca exposto no browser.
 */

export const config = {
  api: { bodyParser: false },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const jwt = process.env.PINATA_JWT;
  if (!jwt) {
    return res.status(500).json({ error: 'PINATA_JWT não configurado.' });
  }

  try {
    const contentType = req.headers['content-type'] || '';

    // ── Upload de arquivo (imagem) ─────────────────────────
    if (contentType.includes('multipart/form-data')) {
      // Lê o body completo em buffer antes de reenviar
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const buffer = Buffer.concat(chunks);

      const pinataRes = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
        method:  'POST',
        headers: {
          Authorization:  `Bearer ${jwt}`,
          'Content-Type': contentType, // preserva o boundary do multipart
        },
        body:   buffer,
        duplex: 'half', // necessário no Next.js 15
      });

      if (!pinataRes.ok) {
        const err = await pinataRes.text();
        return res.status(502).json({ error: `Pinata: ${err}` });
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
        body:   JSON.stringify({ pinataContent: json }),
        duplex: 'half',
      });

      if (!pinataRes.ok) {
        const err = await pinataRes.text();
        return res.status(502).json({ error: `Pinata: ${err}` });
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
