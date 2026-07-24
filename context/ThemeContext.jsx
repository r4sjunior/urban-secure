/**
 * context/ThemeContext.jsx
 * Tema claro/escuro, persistido e sincronizado com o sistema.
 *
 * O tema é aplicado como `data-theme` no <html>, não como classe num
 * componente: o CSS precisa alcançar o `body` e o mapa, que estão fora da
 * árvore React do app.
 *
 * Três estados, não dois — 'dark', 'light' e 'system'. Quem nunca escolheu
 * fica em 'system' e acompanha o aparelho; a partir do momento em que
 * escolhe, a preferência é dela e o sistema para de mandar.
 */

import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'urban-secure:theme';
const ThemeContext = createContext(null);

function systemPrefersDark() {
  if (typeof window === 'undefined') return true;
  return !window.matchMedia?.('(prefers-color-scheme: light)').matches;
}

export function ThemeProvider({ children }) {
  // Começa em 'system' no servidor e no primeiro render do cliente; ler
  // localStorage aqui causaria divergência de hidratação.
  const [preference, setPreference] = useState('system');
  const [resolved, setResolved] = useState('dark');

  useEffect(() => {
    let saved = null;
    try { saved = localStorage.getItem(STORAGE_KEY); } catch {}
    if (saved === 'dark' || saved === 'light') setPreference(saved);
  }, []);

  // Aplica no <html> e mantém em dia com o sistema quando a preferência é
  // 'system' — trocar o tema do celular deve refletir sem reabrir o app.
  useEffect(() => {
    const root = document.documentElement;

    const apply = () => {
      const efetivo = preference === 'system'
        ? (systemPrefersDark() ? 'dark' : 'light')
        : preference;

      setResolved(efetivo);

      if (preference === 'system') root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', efetivo);

      // Mantém a barra de status do celular coerente com a interface.
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', efetivo === 'dark' ? '#0A0B0D' : '#FAFAFB');
    };

    apply();

    if (preference !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [preference]);

  const setTheme = useCallback((next) => {
    setPreference(next);
    try {
      if (next === 'system') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {}
  }, []);

  /** Alterna entre claro e escuro a partir do que está valendo agora. */
  const toggle = useCallback(() => {
    setTheme(resolved === 'dark' ? 'light' : 'dark');
  }, [resolved, setTheme]);

  return (
    <ThemeContext.Provider value={{ theme: resolved, preference, setTheme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme deve ser usado dentro de <ThemeProvider>');
  return ctx;
}
