/**
 * components/ClientOnly.jsx
 *
 * Componente de isolamento SSR.
 * Garante que o conteúdo interno só é renderizado no browser,
 * nunca no servidor do Next.js.
 *
 * Por que isso resolve o hydration mismatch:
 *   - O servidor envia `null` para este componente
 *   - O cliente monta o conteúdo real após o primeiro render
 *   - O React nunca tenta reconciliar HTML diferente entre server/client
 *
 * Uso:
 *   <ClientOnly fallback={<div>Carregando...</div>}>
 *     <ComponenteQueUsaWindow />
 *   </ClientOnly>
 */
import { useState, useEffect } from 'react';

export default function ClientOnly({ children, fallback = null }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return fallback;
  return children;
}
