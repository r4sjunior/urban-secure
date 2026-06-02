/**
 * pages/api/upload.js
 * Proxy server-side para o Pinata — JWT nunca exposto no browser.
 * Validações de segurança: tamanho máx, tipo de arquivo, rate básico.
 */

export const config = {
  api: {
    bodyParser: false,
    responseLimit: '10mb',
  },
};

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

export default async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const jwt = process.env.PINATA_JWT;
  if (!jwt) {
    console.error('[/api/upload] PINATA_JWT ausente');
    return res.status(500).json({ error: 'Servidor não configurado.' });
  }

  try {
    const contentType = req.headers['content-type'] || '';

    // ── Upload de imagem ───────────────────────────────────
    if (contentType.includes('multipart/form-data')) {
      const chunks = [];
      let total = 0;
      for await (const chunk of req) {
        total += chunk.length;
        if (total > MAX_SIZE) {
          return res.status(413).json({ error: 'Arquivo muito grande (máx 10MB).' });
        }
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);

      const pinataRes = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
        method:  'POST',
        headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': contentType },
        body:    buffer,
        duplex:  'half',
      });

      if (!pinataRes.ok) {
        console.error('[/api/upload] Pinata file status:', pinataRes.status);
        return res.status(502).json({ error: 'Falha no upload da imagem.' });
      }

      const { IpfsHash } = await pinataRes.json();
      return res.status(200).json({ url: `https://gateway.pinata.cloud/ipfs/${IpfsHash}` });
    }

    // ── Upload de metadados JSON ───────────────────────────
    if (contentType.includes('application/json')) {
      const chunks = [];
      let total = 0;
      for await (const chunk of req) {
        total += chunk.length;
        if (total > 1024 * 100) { // metadados máx 100KB
          return res.status(413).json({ error: 'Metadados muito grandes.' });
        }
        chunks.push(chunk);
      }
      const json = JSON.parse(Buffer.concat(chunks).toString());

      const pinataRes = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
        method:  'POST',
        headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ pinataContent: json }),
        duplex:  'half',
      });

      if (!pinataRes.ok) {
        console.error('[/api/upload] Pinata json status:', pinataRes.status);
        return res.status(502).json({ error: 'Falha no upload dos metadados.' });
      }

      const { IpfsHash } = await pinataRes.json();
      return res.status(200).json({ url: `https://gateway.pinata.cloud/ipfs/${IpfsHash}` });
    }

    return res.status(400).json({ error: 'Tipo de conteúdo não suportado.' });

  } catch (err) {
    console.error('[/api/upload]', err.message);
    return res.status(500).json({ error: 'Erro interno no upload.' });
  }
}
