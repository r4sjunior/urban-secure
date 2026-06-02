/**
 * pages/api/upload.js
 * Proxy server-side para o Pinata — JWT nunca exposto no browser.
 *
 * Recebe SEMPRE JSON:
 *   { type: 'image', data: base64, filename, mime }  → upload de imagem
 *   { type: 'json',  data: {...} }                    → upload de metadados
 *
 * Base64 evita os problemas de proxy de multipart no Next.js/Vercel.
 */

export const config = {
  api: {
    bodyParser: { sizeLimit: '12mb' }, // base64 incha ~33%, então 12mb p/ imagem de 8mb
  },
};

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
    const { type, data, filename, mime } = req.body || {};

    // ── Upload de imagem (base64 → Blob → Pinata) ──────────
    if (type === 'image') {
      if (!data) return res.status(400).json({ error: 'Imagem ausente.' });

      // Remove prefixo data:image/...;base64, se vier
      const base64 = data.includes(',') ? data.split(',')[1] : data;
      const buffer = Buffer.from(base64, 'base64');

      // Monta FormData nativo (Node 18+ na Vercel)
      const form = new FormData();
      const blob = new Blob([buffer], { type: mime || 'image/jpeg' });
      form.append('file', blob, filename || 'arte.jpg');

      const pinataRes = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
        method:  'POST',
        headers: { Authorization: `Bearer ${jwt}` },
        body:    form,
      });

      if (!pinataRes.ok) {
        const errTxt = await pinataRes.text();
        console.error('[/api/upload] Pinata file:', pinataRes.status, errTxt);
        return res.status(502).json({ error: 'Falha no upload da imagem.' });
      }

      const { IpfsHash } = await pinataRes.json();
      return res.status(200).json({ url: `https://gateway.pinata.cloud/ipfs/${IpfsHash}` });
    }

    // ── Upload de metadados JSON ───────────────────────────
    if (type === 'json') {
      if (!data) return res.status(400).json({ error: 'Metadados ausentes.' });

      const pinataRes = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
        method:  'POST',
        headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ pinataContent: data }),
      });

      if (!pinataRes.ok) {
        const errTxt = await pinataRes.text();
        console.error('[/api/upload] Pinata json:', pinataRes.status, errTxt);
        return res.status(502).json({ error: 'Falha no upload dos metadados.' });
      }

      const { IpfsHash } = await pinataRes.json();
      return res.status(200).json({ url: `https://gateway.pinata.cloud/ipfs/${IpfsHash}` });
    }

    return res.status(400).json({ error: 'Tipo inválido.' });

  } catch (err) {
    console.error('[/api/upload]', err.message);
    return res.status(500).json({ error: 'Erro interno no upload.' });
  }
}
