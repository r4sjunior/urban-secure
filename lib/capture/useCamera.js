/**
 * lib/capture/useCamera.js
 * Acesso à câmera ao vivo para registrar arte urbana.
 *
 * POR QUE ISTO EXISTE — o `<input type="file" capture="environment">` que o
 * app usava antes NÃO garante nada: `capture` é uma dica. No iOS Safari abre
 * a câmera, no Android depende do fabricante, e no desktop é ignorado por
 * completo — abre o seletor de arquivos normal. Qualquer pessoa registraria
 * uma foto baixada da internet como arte urbana no local que quisesse.
 *
 * Com `getUserMedia`, os pixels vêm de um MediaStream e são desenhados num
 * canvas. Não existe caminho de código que ponha um arquivo da galeria ali.
 * Não é "mais difícil de burlar" — é estruturalmente impossível pela UI, que
 * é o que o produto precisa: o valor do app inteiro depende de a arte ser
 * real e estar onde diz estar.
 *
 * Efeito colateral útil: imagem gerada por canvas não tem EXIF. Um JPEG que
 * chegue com EXIF de câmera denuncia que veio de arquivo.
 */

import { useState, useRef, useCallback, useEffect } from 'react';

/** Vídeo curto, sem áudio (requisito do produto). 10s é o suficiente pra
 *  mostrar um mural e curto o bastante pra caber no limite de upload. */
export const MAX_VIDEO_MS = 10_000;

const PHOTO_QUALITY = 0.9;
const PHOTO_MAX_WIDTH = 1600;

export const CAMERA_ERRORS = {
  denied: 'Permissão de câmera negada. Libere o acesso nas configurações do navegador para registrar uma arte.',
  notFound: 'Nenhuma câmera encontrada neste dispositivo.',
  insecure: 'A câmera exige uma conexão segura (HTTPS).',
  unsupported: 'Este navegador não suporta captura de câmera.',
  busy: 'A câmera está sendo usada por outro aplicativo.',
  generic: 'Não foi possível acessar a câmera.',
};

function mapError(err) {
  const name = err?.name || '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return CAMERA_ERRORS.denied;
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return CAMERA_ERRORS.notFound;
  if (name === 'NotReadableError' || name === 'TrackStartError') return CAMERA_ERRORS.busy;
  return CAMERA_ERRORS.generic;
}

/** O melhor container de vídeo que o navegador aceita. Safari não faz webm;
 *  sem esta negociação, o MediaRecorder falha no iOS sem explicação. */
function pickVideoMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  const candidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4',
  ];
  return candidates.find(m => MediaRecorder.isTypeSupported(m)) || null;
}

export function useCamera() {
  const [stream, setStream] = useState(null);
  const [error, setError] = useState(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedMs, setRecordedMs] = useState(0);

  const videoRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);

  const stop = useCallback(() => {
    // Parar as tracks é o que apaga a luz da câmera. Sem isto, sair da tela
    // de captura deixa a câmera ligada — o usuário vê o LED aceso e conclui,
    // com razão, que o app continua filmando.
    setStream(prev => {
      prev?.getTracks().forEach(t => t.stop());
      return null;
    });
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    recorderRef.current = null;
    setIsRecording(false);
    setRecordedMs(0);
  }, []);

  const start = useCallback(async (facingMode = 'environment') => {
    setError(null);

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      // getUserMedia só existe em contexto seguro. Distinguir os dois casos
      // importa: em HTTP a solução é o endereço, não a permissão.
      setError(window.isSecureContext === false ? CAMERA_ERRORS.insecure : CAMERA_ERRORS.unsupported);
      return null;
    }

    setIsStarting(true);
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: {
          // `ideal` e não `exact`: com `exact`, um notebook sem câmera
          // traseira falharia em vez de usar a que tem.
          facingMode: { ideal: facingMode },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false, // vídeo sem áudio, por requisito do produto
      });

      setStream(media);
      return media;
    } catch (err) {
      console.error('[useCamera]', err?.name, err?.message);
      setError(mapError(err));
      return null;
    } finally {
      setIsStarting(false);
    }
  }, []);

  // Garante que a câmera desligue se o componente sumir por qualquer motivo
  // (navegação, erro, fechar o sheet).
  useEffect(() => stop, [stop]);

  /**
   * Captura um quadro do vídeo ao vivo como JPEG.
   * @returns {Promise<{ file: File, previewUrl: string, capturedAt: number }>}
   */
  const takePhoto = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) throw new Error('A câmera ainda não está pronta.');

    // Timestamp do instante do clique — comparado depois com o timestamp
    // assinado no registro. Divergência grande indica mídia que não foi
    // capturada naquele momento.
    const capturedAt = Date.now();

    const ratio = video.videoWidth > PHOTO_MAX_WIDTH ? PHOTO_MAX_WIDTH / video.videoWidth : 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * ratio);
    canvas.height = Math.round(video.videoHeight * ratio);

    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('Falha ao gerar a imagem.')), 'image/jpeg', PHOTO_QUALITY);
    });

    const file = new File([blob], `arte-${capturedAt}.jpg`, { type: 'image/jpeg', lastModified: capturedAt });
    return { file, previewUrl: URL.createObjectURL(blob), capturedAt, kind: 'image' };
  }, []);

  /** Começa a gravar. Para sozinho em MAX_VIDEO_MS. */
  const startRecording = useCallback(() => {
    if (!stream || recorderRef.current) return;

    const mimeType = pickVideoMime();
    if (!mimeType) { setError('Este navegador não suporta gravação de vídeo.'); return; }

    // Só as tracks de vídeo: mesmo com audio:false no getUserMedia, ser
    // explícito aqui garante que nenhuma trilha de áudio entre na gravação.
    const videoOnly = new MediaStream(stream.getVideoTracks());

    // Bitrate limitado de propósito: 1080p em vp9 sem teto passa de 10 MB em
    // 10 segundos, e o corpo do POST vai em base64 (infla 33%) contra o
    // limite de 12 MB de /api/upload. A 2.5 Mbps, 10s dão ~3 MB — qualidade
    // de sobra pra um muro e folga confortável no upload.
    const recorder = new MediaRecorder(videoOnly, { mimeType, videoBitsPerSecond: 2_500_000 });
    chunksRef.current = [];
    recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };

    recorderRef.current = recorder;
    recorder.start();

    const startedAt = Date.now();
    setIsRecording(true);
    setRecordedMs(0);

    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      setRecordedMs(elapsed);
      if (elapsed >= MAX_VIDEO_MS) {
        // O limite é aplicado aqui e não só na UI: sem parada automática,
        // uma gravação esquecida estoura o limite de upload da API.
        recorderRef.current?.state === 'recording' && recorderRef.current.stop();
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }, 100);
  }, [stream]);

  /**
   * Para a gravação e devolve o arquivo.
   * @returns {Promise<{ file: File, previewUrl: string, capturedAt: number }>}
   */
  const stopRecording = useCallback(() => {
    return new Promise((resolve, reject) => {
      const recorder = recorderRef.current;
      if (!recorder) return reject(new Error('Nenhuma gravação em andamento.'));

      const finish = () => {
        const mimeType = recorder.mimeType || 'video/webm';
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const capturedAt = Date.now();
        const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';

        recorderRef.current = null;
        chunksRef.current = [];
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        setIsRecording(false);

        if (blob.size === 0) return reject(new Error('A gravação saiu vazia. Tente de novo.'));

        resolve({
          file: new File([blob], `arte-${capturedAt}.${ext}`, { type: mimeType, lastModified: capturedAt }),
          previewUrl: URL.createObjectURL(blob),
          capturedAt,
          kind: 'video',
        });
      };

      if (recorder.state === 'inactive') finish();
      else { recorder.onstop = finish; recorder.stop(); }
    });
  }, []);

  return {
    stream, error, isStarting, isRecording, recordedMs,
    videoRef, start, stop, takePhoto, startRecording, stopRecording,
  };
}
