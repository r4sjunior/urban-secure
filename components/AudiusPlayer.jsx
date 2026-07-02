/**
 * components/AudiusPlayer.jsx
 * Trilha de fundo em loop via API pública de streaming do Audius — mesma faixa
 * do embed anterior ("MPC - fulani riddim" por MWZK, id b4OZP7O).
 * Usa <audio> nativo (não iframe): o widget de embed do Audius não suporta
 * autoplay nem loop (verificado no bundle deles — só aceita ?flavor=) e, por
 * ser de outra origem, não dá pra controlar play/pause/volume via JS.
 * Com <audio> same-origin de reprodução temos loop de verdade e o botão de
 * mute controla a reprodução de fato.
 */
import { useEffect, useRef } from 'react';

const STREAM_URL = 'https://api.audius.co/v1/tracks/b4OZP7O/stream?app_name=urban-secure';

export default function AudiusPlayer({ muted }) {
  const audioRef = useRef(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (muted) {
      audio.pause();
      return;
    }

    // Navegadores bloqueiam autoplay com som antes do 1º gesto do usuário —
    // se falhar agora, tenta de novo no próximo clique/toque na página.
    const retry = () => {
      audio.play().then(
        () => console.log('[AudiusPlayer] tocando após interação do usuário'),
        (err) => console.error('[AudiusPlayer] play() falhou mesmo após clique:', err.name, err.message)
      );
    };
    audio.play().then(
      () => console.log('[AudiusPlayer] autoplay iniciou sem interação'),
      (err) => {
        console.warn('[AudiusPlayer] autoplay bloqueado, aguardando 1º clique/toque:', err.name);
        document.addEventListener('click', retry, { once: true });
        document.addEventListener('touchstart', retry, { once: true });
      }
    );

    return () => {
      document.removeEventListener('click', retry);
      document.removeEventListener('touchstart', retry);
    };
  }, [muted]);

  return (
    <audio
      ref={audioRef}
      src={STREAM_URL}
      loop
      preload="auto"
      style={{ display: 'none' }}
      onError={(e) => console.error('[AudiusPlayer] falha ao carregar a stream:', e.target.error?.message || e.target.error)}
    />
  );
}
