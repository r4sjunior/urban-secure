/**
 * pages/api/upload.js
 * Proxy Pinata — JWT no servidor.
 * Valida conteúdo antes de encaminhar ao Pinata.
 */

export const config = {
  api: { bodyParser: { sizeLimit: '12mb' } },
};

const ALLOWED_MIMES = new Set([
  'image/jpeg', 'image/png', 'image/webp',
  // Vídeo curto sem áudio (components/capture/CameraCapture.jsx). O webm sai
  // do MediaRecorder no Chrome/Firefox; o mp4, no Safari.
  'video/webm', 'video/mp4',
]);

// Detecta o tipo real pelos magic bytes, ignorando o MIME declarado pelo
// cliente — que é só uma string no JSON e pode dizer qualquer coisa.
function detectMediaType(buffer) {
  if (buffer.length < 12) return null;
  // JPEG: FF D8 FF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'image/jpeg';
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return 'image/png';
  // WebP: RIFF....WEBP
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) return 'image/webp';
  // WebM / Matroska: 1A 45 DF A3 (assinatura EBML)
  if (buffer[0] === 0x1A && buffer[1] === 0x45 && buffer[2] === 0xDF && buffer[3] === 0xA3) return 'video/webm';
  // MP4: bytes 4..8 == "ftyp"
  if (buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70) return 'video/mp4';
  return null;
}

// Valida que o JSON tem a estrutura mínima de metadado NFT Urban Secure
function validateNftMetadata(data) {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return false;
  if (typeof data.name !== 'string' || !data.name.trim()) return false;
  if (data.symbol !== 'URBAN') return false;
  // image deve ser URL HTTPS do gateway Pinata ou string vazia (upload ainda em progresso)
  if (data.image !== undefined && typeof data.image !== 'string') return false;
  if (data.image && !data.image.startsWith('https://')) return false;
  return true;
}

// Remove separadores de caminho e limita tamanho para evitar path traversal no nome
function sanitizeFilename(name) {
  if (typeof name !== 'string') return 'arte.jpg';
  return name.replace(/[/\\:*?"<>|]/g, '_').slice(0, 100) || 'arte.jpg';
}

export default async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const jwt = process.env.PINATA_JWT;
  if (!jwt) return res.status(500).json({ error: 'Servidor não configurado.' });

  try {
    const { type, data, filename, mime } = req.body || {};

    // 'image' cobre foto e vídeo — o nome do tipo ficou por compatibilidade
    // com os clientes já publicados; o que manda é o magic byte detectado.
    if (type === 'image' || type === 'media') {
      if (!data) return res.status(400).json({ error: 'Arquivo ausente.' });

      const base64 = data.includes(',') ? data.split(',')[1] : data;
      let buffer;
      try {
        buffer = Buffer.from(base64, 'base64');
      } catch {
        return res.status(400).json({ error: 'Dados de arquivo inválidos.' });
      }

      // Verifica magic bytes — rejeita qualquer coisa que não seja mídia real
      const detectedMime = detectMediaType(buffer);
      if (!detectedMime) {
        return res.status(400).json({ error: 'Arquivo não reconhecido como imagem ou vídeo válido.' });
      }
      if (!ALLOWED_MIMES.has(detectedMime)) {
        return res.status(400).json({ error: 'Tipo não suportado. Use JPEG, PNG, WebP, WebM ou MP4.' });
      }

      const safeFilename = sanitizeFilename(filename);
      const form = new FormData();
      const blob = new Blob([buffer], { type: detectedMime });
      form.append('file', blob, safeFilename);

      const r = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
        method:  'POST',
        headers: { Authorization: `Bearer ${jwt}` },
        body:    form,
      });
      if (!r.ok) {
        const detail = await r.text();
        console.error('[/api/upload] file', r.status, detail.slice(0, 200));
        return res.status(502).json({ error: 'Falha no upload do arquivo.' });
      }
      const { IpfsHash } = await r.json();
      // Devolve o mime detectado: quem chamou precisa dele pra montar o
      // `properties.category` do metadata Metaplex (image vs video).
      return res.status(200).json({ url: `https://gateway.pinata.cloud/ipfs/${IpfsHash}`, mime: detectedMime });
    }

    if (type === 'json') {
      if (!data) return res.status(400).json({ error: 'Metadados ausentes.' });

      // Valida estrutura do metadado antes de enviar ao Pinata
      if (!validateNftMetadata(data)) {
        return res.status(400).json({ error: 'Estrutura de metadados NFT inválida.' });
      }

      const r = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
        method:  'POST',
        headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ pinataContent: data }),
      });
      if (!r.ok) {
        console.error('[/api/upload] json', r.status, (await r.text()).slice(0, 200));
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
