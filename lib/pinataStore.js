/**
 * lib/pinataStore.js
 * "Banco de dados" simples via JSON pinado no Pinata/IPFS: cada coleção
 * (registry, likes, collects, comments, offers, listings...) é UM pin,
 * sempre lido pelo mais recente e reescrito por completo.
 *
 * Pinata não oferece um "put" condicional de verdade, então toda escrita
 * que depende do estado atual (leitura → decide → grava) precisa passar
 * por `mutatePin`, que faz concorrência otimista: relê o hash do pin mais
 * recente bem antes de gravar e, se alguém pinou uma versão mais nova
 * nesse meio-tempo, descarta a tentativa e recomeça do zero com os dados
 * frescos. Sem isso, duas escritas concorrentes na mesma coleção (ex.:
 * o dono aceitando uma proposta enquanto outra proposta é criada em
 * qualquer obra do app) faziam a última a pinar vencer e apagar
 * silenciosamente a outra, mesmo as duas APIs respondendo 200 OK.
 */

const MAX_ATTEMPTS = 6;
const RETRY_BASE_MS = 250;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchLatestPinRow(jwt, name) {
  const q = `https://api.pinata.cloud/data/pinList?status=pinned&pageLimit=1&sortBy=date_pinned&sortOrder=DESC&metadata[name]=${encodeURIComponent(name)}`;
  const r = await fetch(q, { headers: { Authorization: `Bearer ${jwt}` } });
  if (!r.ok) return null;
  const data = await r.json();
  return data?.rows?.[0] || null;
}

async function fetchPinContent(hash, fallback) {
  if (!hash) return fallback;
  const g = await fetch(`https://gateway.pinata.cloud/ipfs/${hash}`);
  const content = await g.json();
  return content ?? fallback;
}

async function getLatestPinWithHash(jwt, name, fallback) {
  try {
    const row = await fetchLatestPinRow(jwt, name);
    const hash = row?.ipfs_pin_hash || null;
    const content = await fetchPinContent(hash, fallback);
    return { content, hash };
  } catch {
    return { content: fallback, hash: null };
  }
}

export async function getLatestPin(jwt, name, fallback) {
  const { content } = await getLatestPinWithHash(jwt, name, fallback);
  return content;
}

export async function savePin(jwt, name, content) {
  try {
    const r = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinataMetadata: { name }, pinataContent: content }),
    });
    if (!r.ok) return null;
    const data = await r.json();
    return data?.IpfsHash || null;
  } catch {
    return null;
  }
}

/**
 * Lançar/retornar isto dentro do `mutate` de `mutatePin` cancela a escrita
 * sem gravar nada — usado pra validações de negócio que dependem do
 * conteúdo atual da coleção (ex.: "proposta já não está mais pendente").
 */
export class MutationAbort {
  constructor(payload) {
    this.payload = payload;
  }
}

/**
 * Leitura-modificação-escrita segura contra concorrência.
 *
 * `mutate(content)` recebe o conteúdo mais recente da coleção e deve
 * retornar `{ data, result }` (data = novo conteúdo completo a gravar,
 * result = o que o endpoint quer devolver ao cliente) ou lançar/retornar
 * um `MutationAbort(payload)` pra cancelar sem gravar.
 *
 * IMPORTANTE: `mutate` deve ser rápido e não deve chamar RPC/verificar
 * pagamento on-chain — isso é caro e não depende do conteúdo da coleção,
 * então tem que acontecer UMA vez, antes de chamar `mutatePin`. Só a
 * decisão que depende do estado compartilhado deve estar aqui dentro,
 * porque ela é reexecutada do zero em cada tentativa de conflito.
 */
export async function mutatePin(jwt, name, fallback, mutate) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const { content, hash } = await getLatestPinWithHash(jwt, name, fallback);

    let mutation;
    try {
      mutation = await mutate(content);
    } catch (err) {
      if (err instanceof MutationAbort) return { ok: false, aborted: true, payload: err.payload };
      throw err;
    }
    if (mutation instanceof MutationAbort) {
      return { ok: false, aborted: true, payload: mutation.payload };
    }

    const { data, result } = mutation;

    // Confere se ninguém pinou uma versão mais nova enquanto a mutação
    // era decidida. Se pinou, descarta esta tentativa (não escreve por
    // cima) e recomeça a partir dos dados atuais.
    const latestRow = await fetchLatestPinRow(jwt, name);
    const currentHash = latestRow?.ipfs_pin_hash || null;
    if (currentHash !== hash) {
      await sleep(RETRY_BASE_MS * (attempt + 1) + Math.random() * 150);
      continue;
    }

    const savedHash = await savePin(jwt, name, data);
    if (!savedHash) return { ok: false, error: 'save-failed' };

    return { ok: true, result, data };
  }
  return { ok: false, error: 'conflict' };
}
