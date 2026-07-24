/**
 * components/shell/ThemeToggle.jsx
 * Alterna claro/escuro. Mostra o ícone do tema que será ATIVADO, não do
 * atual — é a convenção que as pessoas já leem sem pensar (uma lua no modo
 * claro significa "vá para o escuro").
 */

import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { sound } from '../../lib/sound';

export default function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const proximo = theme === 'dark' ? 'claro' : 'escuro';

  return (
    <button
      className="icon-btn"
      onClick={() => { sound.play('click'); toggle(); }}
      title={`Mudar para o tema ${proximo}`}
      aria-label={`Mudar para o tema ${proximo}`}
    >
      {theme === 'dark' ? <Sun className="lucide" /> : <Moon className="lucide" />}
    </button>
  );
}
