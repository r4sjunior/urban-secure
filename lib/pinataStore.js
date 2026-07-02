/**
 * lib/pinataStore.js
 * "Banco de dados" simples via JSON pinado no Pinata/IPFS: cada coleção
 * (registry, likes, collects, comments...) é UM pin, sempre lido pelo mais
 * recente e reescrito por completo. Usado por todos os endpoints que
 * precisam de estado compartilhado sem um banco de dados de verdade.
 */

export async function getLatestPin(jwt, name, fallback) {
  try {
    const q = `https://api.pinata.cloud/data/pinList?status=pinned&pageLimit=1&sortBy=date_pinned&sortOrder=DESC&metadata[name]=${encodeURIComponent(name)}`;
    const r = await fetch(q, { headers: { Authorization: `Bearer ${jwt}` } });
    if (!r.ok) return fallback;
    const data = await r.json();
    const row = data?.rows?.[0];
    if (!row) return fallback;
    const g = await fetch(`https://gateway.pinata.cloud/ipfs/${row.ipfs_pin_hash}`);
    const content = await g.json();
    return content ?? fallback;
  } catch {
    return fallback;
  }
}

export async function savePin(jwt, name, content) {
  const r = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ pinataMetadata: { name }, pinataContent: content }),
  });
  return r.ok;
}
