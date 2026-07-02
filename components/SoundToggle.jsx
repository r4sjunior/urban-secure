/**
 * components/SoundToggle.jsx
 * Botão visível para ligar/desligar som — controla SFX e o player do Audius.
 * Estado (muted) é controlado pelo componente pai (pages/index.jsx) para
 * ficar em sincronia com o AudiusPlayer.
 */
export default function SoundToggle({ muted, onToggle }) {
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
