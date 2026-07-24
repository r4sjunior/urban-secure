/**
 * components/stickers/AlbumGrid.jsx
 * O álbum: um slot por arte registrada no projeto.
 *
 * Slots vazios são o ponto — é o buraco no álbum que faz a pessoa querer
 * voltar amanhã e trocar com alguém. Um grid que só mostrasse o que já foi
 * coletado seria uma galeria, não um álbum, e perderia exatamente o gancho
 * que a mecânica existe pra criar.
 */

import { rarityByKey } from '../../lib/stickers/rarity';
import StickerCard from './StickerCard';

export default function AlbumGrid({ album, onPaste, isWorking }) {
  const { slots, pastedCount, totalSlots, completion } = album;

  if (totalSlots === 0) {
    return (
      <p className="album-empty">
        Nenhuma arte registrada no projeto ainda. Assim que as primeiras obras
        aparecerem, elas viram os slots do seu álbum.
      </p>
    );
  }

  return (
    <>
      <div className="album-progress">
        <div className="album-progress-bar">
          <span style={{ width: `${Math.round(completion * 100)}%` }} />
        </div>
        <span className="album-progress-label">
          <strong>{pastedCount}</strong> de {totalSlots} · {Math.round(completion * 100)}%
        </span>
      </div>

      <div className="album-grid">
        {slots.map(slot => {
          if (slot.filled) {
            const rarity = rarityByKey(slot.sticker.rarity);
            return (
              <div key={slot.albumNumber} className={`album-slot filled rarity-${rarity.key}`} style={{ '--rarity': rarity.color }}>
                <StickerCard
                  sticker={{ ...slot.sticker, albumNumber: slot.albumNumber, ...slot.art }}
                  size="sm"
                  showArtist={false}
                />
              </div>
            );
          }

          // Slot vazio: mostra a silhueta da obra que falta. Ver o que falta
          // é mais motivador que um quadrado cinza anônimo.
          return (
            <div
              key={slot.albumNumber}
              className={`album-slot empty${slot.canPaste ? ' pastable' : ''}`}
              title={slot.canPaste ? 'Você tem esta! Toque para colar' : slot.art.name}
            >
              {slot.art.imageUrl
                ? <img className="album-slot-ghost" src={slot.art.imageUrl} alt="" loading="lazy" />
                : <span className="album-slot-ph">🎨</span>}

              <span className="album-slot-number">#{slot.albumNumber}</span>

              {slot.canPaste && (
                <button
                  className="album-paste"
                  onClick={() => onPaste(slot)}
                  disabled={isWorking}
                >
                  Colar
                </button>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
