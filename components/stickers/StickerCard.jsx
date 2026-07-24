/**
 * components/stickers/StickerCard.jsx
 * A figurinha em si: arte, moldura da raridade, número e crédito ao artista.
 *
 * A moldura é CSS, não pixels gravados no IPFS — ver a decisão em
 * lib/stickers/rarity.js. Este componente é a "cara" da figurinha dentro do
 * app, e também o fallback 2D quando a animação 3D não pode rodar.
 *
 * O crédito ao artista é obrigatório e nunca é opcional: é o incentivo que
 * sustenta o registro de artes, então aparece na face da figurinha, e não
 * escondido num detalhe.
 */

import Link from 'next/link';
import { Image } from 'lucide-react';
import { rarityByKey } from '../../lib/stickers/rarity';

export default function StickerCard({
  sticker, art, size = 'md', showArtist = true, onClick, faded = false,
}) {
  const rarity = rarityByKey(sticker?.rarity);
  const artistName = sticker?.artistName || art?.artistName || 'Anônimo';
  const artistWallet = sticker?.artistWallet || art?.artistWallet;
  const image = sticker?.imageUrl || art?.imageUrl;
  const number = sticker?.albumNumber ?? art?.albumNumber;

  const Wrapper = onClick ? 'button' : 'div';

  return (
    <Wrapper
      className={`sticker sticker-${size} rarity-${rarity.key}${faded ? ' faded' : ''}${onClick ? ' clickable' : ''}`}
      style={{ '--rarity': rarity.color }}
      onClick={onClick}
      type={onClick ? 'button' : undefined}
    >
      <div className="sticker-frame">
        {image
          ? <img className="sticker-img" src={image} alt={artistName} loading="lazy" />
          : <span className="sticker-ph"><Image className="lucide" /></span>}

        {/* Brilho que varre a figurinha. Só em épico e lendário — se tudo
            brilhasse, brilho deixaria de significar raridade. */}
        {(rarity.key === 'epico' || rarity.key === 'lendario') && <span className="sticker-shine" />}

        {number != null && <span className="sticker-number">#{number}</span>}
        <span className="sticker-rarity">{rarity.label}</span>
      </div>

      {showArtist && (
        <div className="sticker-credit">
          {artistWallet ? (
            <Link href={`/perfil/${encodeURIComponent(artistWallet)}`} className="sticker-artist">
              {artistName}
            </Link>
          ) : (
            <span className="sticker-artist">{artistName}</span>
          )}
        </div>
      )}
    </Wrapper>
  );
}
