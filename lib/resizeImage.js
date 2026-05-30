/**
 * lib/resizeImage.js
 *
 * Redimensiona uma imagem client-side usando Canvas antes do upload.
 * - Força largura máxima de 800 px (mantendo proporção)
 * - Converte para JPEG com qualidade 0.85
 * - Retorna um novo File pronto para enviar ao Pinata
 *
 * Benefícios:
 *   • Reduz tamanho médio de ~3 MB → ~150-400 KB
 *   • Upload 5-10x mais rápido no celular
 *   • Diminui custo de armazenamento IPFS
 *   • Sem dependências externas — usa apenas Canvas API nativa
 */

/**
 * @param {File}   file       — arquivo de imagem original
 * @param {number} maxWidth   — largura máxima em pixels (padrão: 800)
 * @param {number} quality    — qualidade JPEG 0-1 (padrão: 0.85)
 * @returns {Promise<File>}   — novo File redimensionado
 */
export function resizeImage(file, maxWidth = 800, quality = 0.85) {
  return new Promise((resolve, reject) => {
    // Cria URL temporária para o arquivo
    const objectUrl = URL.createObjectURL(file);
    const img       = new Image();

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Não foi possível carregar a imagem para redimensionamento.'));
    };

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      const { width, height } = img;

      // Se a imagem já for menor que maxWidth, retorna o arquivo original sem modificação
      if (width <= maxWidth) {
        resolve(file);
        return;
      }

      // Calcula as novas dimensões mantendo a proporção
      const ratio     = maxWidth / width;
      const newWidth  = Math.round(width  * ratio);
      const newHeight = Math.round(height * ratio);

      // Desenha no Canvas com as novas dimensões
      const canvas = document.createElement('canvas');
      canvas.width  = newWidth;
      canvas.height = newHeight;

      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled  = true;
      ctx.imageSmoothingQuality  = 'high';
      ctx.drawImage(img, 0, 0, newWidth, newHeight);

      // Converte para Blob JPEG e embrulha em File
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Falha ao converter canvas para Blob.'));
            return;
          }

          // Preserva o nome original mas garante extensão .jpg
          const baseName   = file.name.replace(/\.[^.]+$/, '');
          const resizedFile = new File(
            [blob],
            `${baseName}.jpg`,
            { type: 'image/jpeg', lastModified: Date.now() }
          );

          resolve(resizedFile);
        },
        'image/jpeg',
        quality
      );
    };

    img.src = objectUrl;
  });
}
