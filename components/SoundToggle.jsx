/**
 * components/SoundToggle.jsx
 * Botão visível para ligar/desligar som (SFX + música).
 * Ao ligar, inicia o AudioContext e a trilha pulsante.
 */
import { useState, useEffect } from 'react';
import { sound } from '../lib/sound';

export default function SoundToggle() {
  const [muted, setMuted] = useState(true);

  useEffect(() => { setMuted(sound.isMuted()); }, []);

  const onToggle = () => {
    const nowMuted = sound.toggleMute();
    setMuted(nowMuted);
    if (!nowMuted) {
      // ligou: inicia trilha e dá um feedback sonoro
      sound.startMusic();
      sound.play('click');
    } else {
      sound.stopMusic();
    }
  };

  return (
    <button
      className={`sound-toggle${muted ? ' off' : ''}`}
      onClick={onToggle}
      title={muted ? 'Ligar som' : 'Desligar som'}
      aria-label={muted ? 'Ligar som' : 'Desligar som'}
    >
      {muted ? '🔇' : '🔊'}
    </button>
  );
}
