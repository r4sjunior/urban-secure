/**
 * components/shell/SplashScreen.jsx
 * Abertura do app: marca, proposta em uma frase e os quatro pilares.
 *
 * Substitui a tela de boot em ASCII estilo terminal. Aquela era divertida,
 * mas gastava 8 segundos com texto de máquina antes de o usuário entender o
 * que o app faz — e era exatamente o traço visual que datava a interface.
 *
 * Esta dura ~2,6s, sai sozinha, e é pulável a qualquer momento. Abertura que
 * não pode ser pulada vira obstáculo a partir da segunda vez.
 */

import { useEffect, useState } from 'react';
import { Camera, Flame, Layers, Trophy, SprayCan } from 'lucide-react';
import { sound } from '../../lib/sound';

const PILARES = [
  { Icon: Camera, titulo: 'Registre na rua',   texto: 'Só com a câmera, no local da obra' },
  { Icon: Flame,  titulo: 'Volte todo dia',    texto: 'Claim diário e streak de 7 dias' },
  { Icon: Layers, titulo: 'Colecione',         texto: 'Figurinhas das artes da rede' },
  { Icon: Trophy, titulo: 'Dispute a semana',  texto: 'Ranking com premiação em SOL' },
];

const DURACAO_MS = 2600;

export default function SplashScreen({ onDone }) {
  const [saindo, setSaindo] = useState(false);

  useEffect(() => {
    const fim = setTimeout(() => setSaindo(true), DURACAO_MS);
    // O onDone é disparado depois da transição de saída, senão o conteúdo
    // por baixo aparece com um salto no meio do fade.
    const done = setTimeout(onDone, DURACAO_MS + 420);
    return () => { clearTimeout(fim); clearTimeout(done); };
  }, [onDone]);

  function pular() {
    sound.play('click');
    setSaindo(true);
    setTimeout(onDone, 300);
  }

  return (
    <div className={`splash${saindo ? ' out' : ''}`}>
      <div className="splash-glow" />

      <div className="splash-body">
        <div className="splash-mark">
          <SprayCan className="lucide" />
        </div>

        <h1 className="splash-title">
          URBAN<span className="splash-title-accent">SECURE</span>
        </h1>

        <p className="splash-tagline">A rede da arte urbana, registrada na blockchain</p>

        <ul className="splash-pilares">
          {PILARES.map(({ Icon, titulo, texto }, i) => (
            // O atraso escalonado guia o olho de cima para baixo em vez de
            // despejar os quatro cartões de uma vez.
            <li key={titulo} className="splash-pilar" style={{ animationDelay: `${360 + i * 130}ms` }}>
              <span className="splash-pilar-ico"><Icon className="lucide" /></span>
              <span className="splash-pilar-txt">
                <strong>{titulo}</strong>
                <small>{texto}</small>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <button className="splash-skip" onClick={pular}>Entrar</button>
    </div>
  );
}
