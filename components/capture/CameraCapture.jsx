/**
 * components/capture/CameraCapture.jsx
 * Viewfinder ao vivo: foto ou vídeo curto, sem opção de galeria.
 *
 * A ausência de um botão "escolher arquivo" é a feature, não uma limitação —
 * ver o comentário de topo de lib/capture/useCamera.js. Quando a câmera é
 * negada, a tela explica e bloqueia; não existe caminho alternativo, senão a
 * garantia não valeria nada.
 */

import { useState, useEffect, useRef } from 'react';
import { Ban, X, SwitchCamera } from 'lucide-react';
import { useCamera, MAX_VIDEO_MS } from '../../lib/capture/useCamera';
import { sound } from '../../lib/sound';

export default function CameraCapture({ open, onCapture, onClose }) {
  const {
    stream, error, isStarting, isRecording, recordedMs,
    videoRef, start, stop, takePhoto, startRecording, stopRecording,
  } = useCamera();

  const [mode, setMode] = useState('photo'); // 'photo' | 'video'
  const [facing, setFacing] = useState('environment');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(false);

  // Liga a câmera ao abrir e desliga ao fechar. O cleanup do useCamera já
  // para as tracks, mas ser explícito aqui evita deixar a câmera ligada
  // quando o componente continua montado com open=false.
  useEffect(() => {
    if (open) start(facing);
    else stop();
  }, [open, facing]); // eslint-disable-line react-hooks/exhaustive-deps

  // Conecta o stream ao <video>. Precisa acontecer depois que o elemento
  // existe no DOM, por isso um efeito e não uma prop.
  useEffect(() => {
    const el = videoRef.current;
    if (el && stream && el.srcObject !== stream) {
      el.srcObject = stream;
      el.play().catch(() => { /* autoplay bloqueado — o usuário toca pra iniciar */ });
    }
  }, [stream, videoRef]);

  if (!open) return null;

  async function handlePhoto() {
    setBusy(true);
    try {
      // Flash branco curto: confirma visualmente que o quadro foi congelado
      // naquele instante, que é justamente o que o app está garantindo.
      setFlash(true);
      setTimeout(() => setFlash(false), 120);
      sound.play('click');

      const media = await takePhoto();
      stop();
      onCapture(media);
    } catch (err) {
      console.error('[CameraCapture] foto:', err);
    } finally {
      setBusy(false);
    }
  }

  async function handleVideoToggle() {
    if (isRecording) {
      setBusy(true);
      try {
        const media = await stopRecording();
        stop();
        onCapture(media);
      } catch (err) {
        console.error('[CameraCapture] vídeo:', err);
      } finally {
        setBusy(false);
      }
    } else {
      sound.play('click');
      startRecording();
    }
  }

  const seconds = (recordedMs / 1000).toFixed(1);
  const progress = Math.min(100, (recordedMs / MAX_VIDEO_MS) * 100);

  return (
    <div className="camera">
      <div className="camera-stage">
        <video
          ref={videoRef}
          className="camera-video"
          playsInline
          muted
          autoPlay
          // Espelhar só a câmera frontal — é o que o usuário espera ao se ver.
          // Espelhar a traseira deixaria textos do muro invertidos.
          style={{ transform: facing === 'user' ? 'scaleX(-1)' : 'none' }}
        />

        {flash && <div className="camera-flash" />}

        {isStarting && !stream && (
          <div className="camera-msg"><span className="camera-spinner" />Abrindo a câmera…</div>
        )}

        {error && (
          <div className="camera-msg camera-err">
            <span className="camera-err-icon"><Ban className="lucide" /></span>
            <p>{error}</p>
            <p className="camera-err-why">
              O registro só aceita fotos feitas na hora — é o que garante que a arte
              é real e está onde você diz que está.
            </p>
            <button className="btn-ghost" onClick={() => start(facing)}>Tentar de novo</button>
          </div>
        )}

        {isRecording && (
          <div className="camera-rec">
            <span className="camera-rec-dot" />
            {seconds}s
            <span className="camera-rec-bar"><span style={{ width: `${progress}%` }} /></span>
          </div>
        )}

        <button className="camera-close" onClick={() => { stop(); onClose(); }} aria-label="Fechar"><X className="lucide" /></button>
      </div>

      <div className="camera-controls">
        <div className="camera-modes">
          <button
            className={`camera-mode${mode === 'photo' ? ' on' : ''}`}
            onClick={() => setMode('photo')}
            disabled={isRecording}
          >
            Foto
          </button>
          <button
            className={`camera-mode${mode === 'video' ? ' on' : ''}`}
            onClick={() => setMode('video')}
            disabled={isRecording}
          >
            Vídeo
          </button>
        </div>

        <div className="camera-actions">
          <button
            className="camera-flip"
            onClick={() => setFacing(f => (f === 'environment' ? 'user' : 'environment'))}
            disabled={isRecording || busy || !stream}
            aria-label="Virar câmera"
          >
            <SwitchCamera className="lucide" />
          </button>

          <button
            className={`camera-shutter${mode === 'video' ? ' video' : ''}${isRecording ? ' rec' : ''}`}
            onClick={mode === 'photo' ? handlePhoto : handleVideoToggle}
            disabled={!stream || busy}
            aria-label={mode === 'photo' ? 'Tirar foto' : isRecording ? 'Parar gravação' : 'Gravar'}
          >
            <span className="camera-shutter-inner" />
          </button>

          {/* Espaçador — mantém o obturador centrado sem depender de margem
              negativa, que quebraria em telas estreitas. */}
          <span className="camera-spacer" />
        </div>

        <p className="camera-hint">
          {mode === 'photo'
            ? 'Aponte para a obra e toque para registrar'
            : isRecording
              ? 'Toque para parar'
              : `Vídeo de até ${MAX_VIDEO_MS / 1000}s, sem áudio`}
        </p>
      </div>
    </div>
  );
}
