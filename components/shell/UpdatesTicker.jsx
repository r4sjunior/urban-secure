/**
 * components/shell/UpdatesTicker.jsx
 * Faixa de novidades que corre na parte inferior da tela.
 *
 * O conteúdo é duplicado no DOM de propósito: a animação desloca a faixa em
 * exatamente -50%, então quando a primeira cópia sai de quadro a segunda já
 * está na posição inicial e o loop não tem emenda. Sem a duplicata, haveria
 * um salto visível a cada volta.
 *
 * Pausa no hover e respeita `prefers-reduced-motion` (o reset global corta a
 * animação) — texto em movimento contínuo é um problema real de leitura para
 * parte das pessoas, e não há por que forçá-lo.
 */

import { useState } from 'react';
import { Megaphone, X } from 'lucide-react';
import { UPDATES, APP_VERSION } from '../../lib/appUpdates';

const DISMISS_KEY = 'urban-secure:ticker-hidden-v1';

export default function UpdatesTicker() {
  const [oculto, setOculto] = useState(() => {
    if (typeof window === 'undefined') return false;
    try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
  });

  if (oculto || UPDATES.length === 0) return null;

  function fechar() {
    setOculto(true);
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch {}
  }

  const itens = UPDATES.map(u => (
    <span className="ticker-item" key={u.id}>
      <span className="ticker-tag">{u.tag}</span>
      {u.texto}
    </span>
  ));

  return (
    <div className="ticker">
      <span className="ticker-label">
        <Megaphone className="lucide" />
        <span className="ticker-version">{APP_VERSION}</span>
      </span>

      <div className="ticker-viewport">
        <div className="ticker-track">
          {itens}
          {/* Cópia para o loop contínuo — escondida de leitores de tela,
              que já anunciaram o conteúdo uma vez. */}
          <span className="ticker-clone" aria-hidden="true">{itens}</span>
        </div>
      </div>

      <button className="ticker-close" onClick={fechar} aria-label="Ocultar novidades">
        <X className="lucide" />
      </button>
    </div>
  );
}
