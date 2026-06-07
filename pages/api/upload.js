/**
 * pages/api/upload.js
 * Proxy Pinata — JWT no servidor. Recebe base64 JSON (confiável).
 */

export const config = {
  api: { bodyParser: { sizeLimit: '12mb' } },
};

export default async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const jwt = process.env.PINATA_JWT;
  if (!jwt) return res.status(500).json({ error: 'Servidor não configurado.' });

  try {
    const { type, data, filename, mime } = req.body || {};

    if (type === 'image') {
      if (!data) return res.status(400).json({ error: 'Imagem ausente.' });
      const base64 = data.includes(',') ? data.split(',')[1] : data;
      const buffer = Buffer.from(base64, 'base64');

      const form = new FormData();
      const blob = new Blob([buffer], { type: mime || 'image/jpeg' });
      form.append('file', blob, filename || 'arte.jpg');

      const r = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
        method:  'POST',
        headers: { Authorization: `Bearer ${jwt}` },
        body:    form,
      });
      if (!r.ok) {
        const detail = await r.text();
        console.error('[/api/upload] file', r.status, detail);
        return res.status(502).json({ error: 'Falha no upload da imagem.' });
      }
      const { IpfsHash } = await r.json();
      return res.status(200).json({ url: `https://gateway.pinata.cloud/ipfs/${IpfsHash}` });
    }

    if (type === 'json') {
      if (!data) return res.status(400).json({ error: 'Metadados ausentes.' });
      const r = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
        method:  'POST',
        headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ pinataContent: data }),
      });
      if (!r.ok) {
        console.error('[/api/upload] json', r.status, await r.text());
        return res.status(502).json({ error: 'Falha no upload dos metadados.' });
      }
      const { IpfsHash } = await r.json();
      return res.status(200).json({ url: `https://gateway.pinata.cloud/ipfs/${IpfsHash}` });
    }

    return res.status(400).json({ error: 'Tipo inválido.' });
  } catch (err) {
    console.error('[/api/upload]', err.message);
    return res.status(500).json({ error: 'Erro interno no upload.' });
  }
}
