/**
 * lib/fetchArts.js
 * Busca artes via API route interna — Helius key nunca exposta no browser.
 */

export async function fetchAllUrbanArts() {
  try {
    const res = await fetch('/api/arts');
    if (!res.ok) throw new Error('Erro ao buscar artes');
    const { arts } = await res.json();
    return arts ?? [];
  } catch (err) {
    console.error('[fetchAllUrbanArts]', err.message);
    return [];
  }
}
