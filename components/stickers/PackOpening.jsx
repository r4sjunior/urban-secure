/**
 * components/stickers/PackOpening.jsx
 * Orquestra a abertura de um pacote: chama a API, roda a animação, revela.
 *
 * Separa DADOS de ESPETÁCULO. Este componente cuida do estado (pedir ao
 * servidor, tratar erro, avisar quem chamou); a cena 3D (Pack3D) só recebe
 * `state` e desenha. É o que permite a animação falhar — WebGL indisponível,
 * three.js não carregando, `prefers-reduced-motion` — sem que o usuário
 * perca a figurinha que já foi mintada on-chain.
 */

import { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { sound } from '../../lib/sound';
import StickerCard from './StickerCard';

// three.js pesa ~600 KB gzip. Carregado só quando um pacote é aberto — nunca
// no bundle da home, que é um mapa e não deve baixar uma engine 3D.
const Pack3D = dynamic(() => import('./Pack3D'), {
  ssr: false,
  loading: () => <div className="pack-loading" />,
});

/** WebGL pode faltar (driver antigo, modo de economia, navegador restrito).
 *  Testar antes evita montar uma cena que só produziria tela preta. */
function hasWebGL() {
  try {
    const canvas = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
  } catch {
    return false;
  }
}

function prefersReducedMotion() {
  return typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export default function PackOpening({ open, onClose, onOpenPack, onRevealed }) {
  // idle → opening (rede) → tearing/revealing (animação) → revealed | error
  const [phase, setPhase] = useState('idle');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [use3D, setUse3D] = useState(false);

  // Guarda contra duplo toque: o clique dispara um mint pago pela treasury,
  // então dois cliques rápidos não podem virar duas aberturas.
  const startedRef = useRef(false);

  useEffect(() => {
    if (!open) {
      setPhase('idle'); setResult(null); setError(null);
      startedRef.current = false;
      return;
    }
    setUse3D(hasWebGL() && !prefersReducedMotion());
  }, [open]);

  if (!open) return null;

  async function handleOpen() {
    if (startedRef.current) return;
    startedRef.current = true;

    setPhase('opening');
    setError(null);
    sound.play('transaction');

    const res = await onOpenPack();

    if (!res.ok) {
      setError(res.error || 'Não foi possível abrir o pacote.');
      setPhase('error');
      startedRef.current = false;
      sound.play('error');
      return;
    }

    setResult(res);

    if (use3D) {
      // A cena assume o controle e chama handleRevealed no fim.
      setPhase('tearing');
    } else {
      // Sem 3D, revela direto — o conteúdo é o mesmo, só sem o espetáculo.
      setPhase('revealed');
      sound.play('success');
      onRevealed?.(res);
    }
  }

  function handleRevealed() {
    setPhase('revealed');
    sound.play('success');
    onRevealed?.(result);
  }

  return (
    <div className="pack-overlay">
      <div className="pack-backdrop" onClick={() => phase !== 'opening' && phase !== 'tearing' && onClose()} />

      <div className="pack-stage">
        {phase === 'idle' && (
          <div className="pack-intro">
            <div className="pack-intro-icon">🎁</div>
            <h2 className="pack-intro-title">Pacote de Figurinha</h2>
            <p className="pack-intro-sub">
              Você fechou 7 dias seguidos. Dentro tem uma arte registrada por
              outro artista da rede — pode vir rara.
            </p>
            <button className="mint-cta" onClick={handleOpen}>Abrir pacote</button>
          </div>
        )}

        {phase === 'opening' && (
          <div className="pack-intro">
            <div className="pack-intro-icon pack-spin">🎁</div>
            <p className="pack-intro-sub">Sorteando sua figurinha…</p>
          </div>
        )}

        {(phase === 'tearing' || (phase === 'revealed' && use3D)) && result && (
          <Pack3D
            state={phase === 'tearing' ? 'tearing' : 'revealed'}
            rarity={result.rarity}
            imageUrl={result.art?.imageUrl}
            onRevealed={handleRevealed}
          />
        )}

        {phase === 'revealed' && (
          <div className="pack-reveal">
            {!use3D && result && (
              <StickerCard
                sticker={{
                  rarity: result.rarity,
                  albumNumber: result.albumNumber,
                  artistName: result.art?.artistName,
                  artistWallet: result.art?.artistWallet,
                  imageUrl: result.art?.imageUrl,
                }}
                size="lg"
              />
            )}

            <div className="pack-reveal-info">
              <h3 className="pack-reveal-title">{result?.art?.name}</h3>
              <p className="pack-reveal-artist">por {result?.art?.artistName || 'Anônimo'}</p>
              <p className="pack-reveal-hint">
                A figurinha está na sua carteira. Cole no álbum ou guarde para trocar.
              </p>
            </div>

            <button className="mint-cta" onClick={onClose}>Ver no álbum</button>
          </div>
        )}

        {phase === 'error' && (
          <div className="pack-intro">
            <div className="pack-intro-icon">⚠️</div>
            <p className="pack-intro-sub">{error}</p>
            <button className="btn-ghost" onClick={onClose}>Fechar</button>
          </div>
        )}
      </div>
    </div>
  );
}
