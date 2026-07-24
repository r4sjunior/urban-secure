/**
 * components/shell/Onboarding.jsx
 * Tutorial da proposta do app, em passos.
 *
 * Aparece uma vez, no primeiro acesso, e fica acessível depois pelo menu —
 * tutorial que só existe na primeira abertura é tutorial que ninguém lê,
 * porque na primeira abertura a pessoa quer é ver o app.
 *
 * O conteúdo vem de lib/appUpdates.js, a mesma fonte do ticker de novidades.
 */

import { useState } from 'react';
import { MapPin, Camera, Flame, Layers, Trophy, ArrowRight, Check } from 'lucide-react';
import { TUTORIAL } from '../../lib/appUpdates';
import { sound } from '../../lib/sound';

const ICONES = { MapPin, Camera, Flame, Layers, Trophy };

export const ONBOARDING_KEY = 'urban-secure:onboarding-v1';

/** Já viu o tutorial? A chave tem versão: mudanças grandes na proposta
 *  justificam mostrar de novo, e aí basta subir o `-v1`. */
export function jaViuOnboarding() {
  try { return localStorage.getItem(ONBOARDING_KEY) === '1'; }
  catch { return true; } // sem storage, não insiste
}

export function marcarOnboardingVisto() {
  try { localStorage.setItem(ONBOARDING_KEY, '1'); } catch {}
}

export default function Onboarding({ open, onClose }) {
  const [passo, setPasso] = useState(0);
  if (!open) return null;

  const atual = TUTORIAL[passo];
  const Icone = ICONES[atual.icone] || MapPin;
  const ultimo = passo === TUTORIAL.length - 1;

  function avancar() {
    sound.play('click');
    if (ultimo) { marcarOnboardingVisto(); onClose(); }
    else setPasso(p => p + 1);
  }

  function pular() {
    marcarOnboardingVisto();
    onClose();
  }

  return (
    <div className="tour">
      <div className="tour-card">
        <button className="tour-skip" onClick={pular}>Pular</button>

        <div className="tour-icon"><Icone className="lucide" /></div>

        {/* A key força o React a remontar o bloco a cada passo, o que
            redispara a animação de entrada — sem ela, o texto trocaria
            secamente no lugar. */}
        <div className="tour-text" key={atual.id}>
          <h2 className="tour-title">{atual.titulo}</h2>
          <p className="tour-desc">{atual.texto}</p>
        </div>

        <div className="tour-dots">
          {TUTORIAL.map((t, i) => (
            <button
              key={t.id}
              className={`tour-dot${i === passo ? ' on' : ''}`}
              onClick={() => setPasso(i)}
              aria-label={`Passo ${i + 1}: ${t.titulo}`}
            />
          ))}
        </div>

        <button className="dock-cta tour-next" onClick={avancar}>
          {ultimo ? <><Check className="lucide" /> Começar</> : <>Próximo <ArrowRight className="lucide" /></>}
        </button>
      </div>
    </div>
  );
}
