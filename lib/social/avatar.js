/**
 * lib/social/avatar.js
 * Recorte quadrado central + redimensionamento da foto de perfil.
 *
 * Separado de lib/resizeImage.js porque o objetivo é outro: aquele preserva
 * a proporção da obra (recortar uma arte seria mutilar o registro), este
 * força 1:1 porque avatar é sempre exibido em círculo — sem o recorte, uma
 * foto retrato chegaria esticada ou com o rosto fora do enquadramento.
 */

const AVATAR_SIZE = 400;   // suficiente pra retina em 128px de exibição
const AVATAR_QUALITY = 0.85;

/**
 * Recorta o quadrado central da imagem e redimensiona para AVATAR_SIZE.
 * @param {File} file
 * @returns {Promise<File>} JPEG quadrado
 */
export function cropSquareAvatar(file, size = AVATAR_SIZE, quality = AVATAR_QUALITY) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Falha ao carregar imagem.'));
    };

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      // Maior quadrado que cabe na imagem, centralizado
      const side = Math.min(img.width, img.height);
      const sx = (img.width - side) / 2;
      const sy = (img.height - side) / 2;

      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;

      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);

      canvas.toBlob(
        (blob) => {
          if (!blob) return reject(new Error('Falha no canvas.'));
          resolve(new File([blob], 'avatar.jpg', {
            type: 'image/jpeg',
            lastModified: Date.now(),
          }));
        },
        'image/jpeg', quality
      );
    };

    img.src = objectUrl;
  });
}
