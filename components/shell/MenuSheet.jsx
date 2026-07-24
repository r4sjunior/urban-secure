/**
 * components/shell/MenuSheet.jsx
 * Gaveta de navegação secundária.
 *
 * POR QUE ISTO EXISTE: a barra do topo acumulou nove botões (feed, ranking,
 * curtidas, álbum, mercado, streak, perfil, som, música). Nove alvos de
 * toque de 40px numa tela de celular não cabem sem encolher tudo, e foi isso
 * que produziu a fileira de quadradinhos apertados.
 *
 * Aqui o critério é frequência: fica no topo o que se usa em toda sessão
 * (GPS, streak, perfil); vai para a gaveta o que se usa às vezes. A gaveta
 * dá espaço para rótulo de texto, então cada item fica mais claro do que era
 * como ícone solto.
 */

import Link from 'next/link';
import {
  Newspaper, Trophy, Heart, Layers, Sun, Moon,
  Volume2, VolumeX, HelpCircle, X,
} from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { sound } from '../../lib/sound';
import { APP_VERSION } from '../../lib/appUpdates';

export default function MenuSheet({
  open, onClose, onFeed, onLeaderboard, onTutorial, muted, onToggleSound,
}) {
  const { theme, toggle: toggleTheme } = useTheme();
  if (!open) return null;

  const ir = (fn) => () => { sound.play('click'); onClose(); fn?.(); };

  return (
    <div className="menu">
      <div className="menu-backdrop" onClick={onClose} />

      <div className="menu-panel">
        <div className="menu-head">
          <span className="menu-title">Menu</span>
          <button className="icon-btn" onClick={onClose} aria-label="Fechar">
            <X className="lucide" />
          </button>
        </div>

        <nav className="menu-grid">
          <button className="menu-item" onClick={ir(onFeed)}>
            <span className="menu-item-ico"><Newspaper className="lucide" /></span>
            Feed
          </button>

          <Link href="/ranking" className="menu-item" onClick={onClose}>
            <span className="menu-item-ico"><Trophy className="lucide" /></span>
            Ranking
          </Link>

          <Link href="/album" className="menu-item" onClick={onClose}>
            <span className="menu-item-ico"><Layers className="lucide" /></span>
            Álbum
          </Link>

          <button className="menu-item" onClick={ir(onLeaderboard)}>
            <span className="menu-item-ico"><Heart className="lucide" /></span>
            Mais curtidas
          </button>
        </nav>

        <div className="menu-list">
          {/* Rótulo fixo + estado atual à direita. "Tema claro … escuro" era
              ambíguo: o rótulo dizia a ação e a dica dizia o estado, então a
              linha se contradizia na leitura. */}
          <button className="menu-row" onClick={() => { sound.play('click'); toggleTheme(); }}>
            {theme === 'dark' ? <Sun className="lucide" /> : <Moon className="lucide" />}
            <span>Tema</span>
            <span className="menu-row-hint">{theme === 'dark' ? 'Escuro' : 'Claro'}</span>
          </button>

          <button className="menu-row" onClick={onToggleSound}>
            {muted ? <VolumeX className="lucide" /> : <Volume2 className="lucide" />}
            <span>Sons do app</span>
            <span className="menu-row-hint">{muted ? 'desligado' : 'ligado'}</span>
          </button>

          <button className="menu-row" onClick={ir(onTutorial)}>
            <HelpCircle className="lucide" />
            <span>Como funciona</span>
          </button>
        </div>

        <p className="menu-version">Urban Secure · {APP_VERSION} · devnet</p>
      </div>
    </div>
  );
}
