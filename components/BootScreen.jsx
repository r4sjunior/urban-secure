/**
 * components/BootScreen.jsx
 * Tela de abertura estilo boot de Linux/terminal.
 * Logo ASCII "URBAN SECURE", mensagens de carregamento com efeito de digitação,
 * chamada de "discando", barra de progresso e botão "skip" sempre visível.
 *
 * Props:
 *   onDone() — chamado quando o boot termina (naturalmente ou via skip)
 */
import { useEffect, useRef, useState } from 'react';
import { sound } from '../lib/sound';

const ASCII = String.raw`
 ██╗   ██╗██████╗ ██████╗  █████╗ ███╗   ██╗
 ██║   ██║██╔══██╗██╔══██╗██╔══██╗████╗  ██║
 ██║   ██║██████╔╝██████╔╝███████║██╔██╗ ██║
 ██║   ██║██╔══██╗██╔══██╗██╔══██║██║╚██╗██║
 ╚██████╔╝██║  ██║██████╔╝██║  ██║██║ ╚████║
  ╚═════╝ ╚═╝  ╚═╝╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═══╝
 ███████╗███████╗ ██████╗██╗   ██╗██████╗ ███████╗
 ██╔════╝██╔════╝██╔════╝██║   ██║██╔══██╗██╔════╝
 ███████╗█████╗  ██║     ██║   ██║██████╔╝█████╗
 ╚════██║██╔══╝  ██║     ██║   ██║██╔══██╗██╔══╝
 ███████║███████╗╚██████╗╚██████╔╝██║  ██║███████╗
 ╚══════╝╚══════╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝`;

// Cada linha: { tag, text, delay até a próxima }
// Mensagens fundem tecnologia e arte de rua — nada de jargão técnico cru.
const LINES = [
  { tag: 'sys',  text: 'URBAN SECURE :: onde o muro vira galeria', d: 500 },
  { tag: 'dim',  text: 'traduzindo spray em memória eterna...', d: 700 },
  { tag: 'sp',   text: '', d: 250 },
  { tag: 'ok',   text: 'Tinta e pixel, na mesma parede', d: 550 },
  { tag: 'ok',   text: 'Cada traço vira parte da cidade', d: 550 },
  { tag: 'wait', text: 'Ouvindo o pulso das ruas...', d: 700 },
  { tag: 'ok',   text: 'Arte urbana e blockchain, em sintonia', d: 550 },
  { tag: 'dial', text: 'Localizando artistas por perto', d: 1500 },
  { tag: 'ok',   text: 'Sinal encontrado nos becos e avenidas', d: 550 },
  { tag: 'ok',   text: 'Cada obra registrada, para sempre', d: 650 },
  { tag: 'go',   text: 'Bem-vindo, artista. O mundo é sua galeria.', d: 900 },
];

function prefixFor(tag) {
  switch (tag) {
    case 'ok':   return '[ OK ]';
    case 'wait': return '[ .. ]';
    case 'dial': return '[DIAL]';
    case 'go':   return '[ ►► ]';
    default:     return '';
  }
}

export default function BootScreen({ onDone }) {
  const [shown, setShown] = useState([]);   // linhas já exibidas
  const [progress, setProgress] = useState(0);
  const [dialDots, setDialDots] = useState('');
  const doneRef = useRef(false);
  const timers = useRef([]);

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    timers.current.forEach(clearTimeout);
    onDone && onDone();
  };

  useEffect(() => {
    let acc = 0;
    LINES.forEach((line, i) => {
      const t = setTimeout(() => {
        setShown(prev => [...prev, line]);
        setProgress(Math.round(((i + 1) / LINES.length) * 100));
        // som por linha (só toca se o usuário já ligou o áudio)
        if (line.tag === 'ok' || line.tag === 'sys') sound.play('bootTick');
        else if (line.tag === 'dial') sound.play('transaction');
        else if (line.tag === 'go') sound.play('bootConnected');
      }, acc);
      timers.current.push(t);
      acc += line.d;
    });
    // encerra ~600ms após a última linha
    const end = setTimeout(finish, acc + 600);
    timers.current.push(end);
    return () => timers.current.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // animação dos pontos do "discando"
  useEffect(() => {
    const hasDial = shown.some(l => l.tag === 'dial');
    if (!hasDial) return;
    let n = 0;
    const iv = setInterval(() => {
      n = (n + 1) % 9;
      setDialDots('.'.repeat(n));
    }, 130);
    return () => clearInterval(iv);
  }, [shown]);

  return (
    <div className="boot" onClick={finish} role="button" title="Clique para pular">
      <div className="boot-scanlines" />
      <button className="boot-skip" onClick={(e) => { e.stopPropagation(); finish(); }}>skip ▶</button>

      <div className="boot-inner">
        <pre className="boot-ascii">{ASCII}</pre>

        <div className="boot-log">
          {shown.map((line, i) => {
            if (line.tag === 'sp') return <div key={i} className="boot-line">&nbsp;</div>;
            const pre = prefixFor(line.tag);
            const isDial = line.tag === 'dial';
            return (
              <div key={i} className={`boot-line bl-${line.tag}`}>
                {pre && <span className="boot-pre">{pre}</span>}
                <span className="boot-text">
                  {line.text}
                  {isDial && <span className="boot-dial">{dialDots}{dialDots.length >= 8 ? ' CONNECTED' : ''}</span>}
                </span>
              </div>
            );
          })}
          <span className="boot-cursor">█</span>
        </div>

        <div className="boot-bar">
          <div className="boot-bar-fill" style={{ width: `${progress}%` }} />
          <span className="boot-bar-pct">{progress}%</span>
        </div>
      </div>
    </div>
  );
}
