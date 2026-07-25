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

/**
 * Último hash que NÓS gravamos, por coleção.
 *
 * POR QUE ISTO É NECESSÁRIO: o `pinList` do Pinata leva alguns segundos para
 * refletir um pin recém-criado. Duas escritas próximas no tempo liam o mesmo
 * estado antigo — a segunda não enxergava a primeira nem no momento da
 * leitura, nem na verificação de conflito — e a última a gravar apagava a
 * outra. Medido: três registros de arte em sequência (900ms de intervalo)
 * resultaram em três pins com UMA arte cada, em vez de 1, 2 e 3.
 *
 * O sintoma no produto é silencioso e grave: a API responde 200, o usuário vê
 * "arte registrada", e a arte some do índice.
 *
 * Guardando o hash do que acabamos de gravar, a próxima operação parte do
 * estado real mesmo antes de o `pinList` alcançá-lo.
 *
 * LIMITE: é memória de processo. Em serverless, duas instâncias diferentes
 * continuam sujeitas à janela — mas a verificação de conflito de `mutatePin`
 * ainda cobre esse caso, porque aí os hashes de fato divergem. O que este
 * cache resolve é o cenário sequencial, que era o que perdia dados.
 */
const ultimoHashGravado = new Map();

async function fetchLatestPinRow(jwt, name) {
  const q = `https://api.pinata.cloud/data/pinList?status=pinned&pageLimit=1&sortBy=date_pinned&sortOrder=DESC&metadata[name]=${encodeURIComponent(name)}`;
  const r = await fetch(q, { headers: { Authorization: `Bearer ${jwt}` } });
  if (!r.ok) return null;
  const data = await r.json();
  return data?.rows?.[0] || null;
}

/**
 * Gateways IPFS, consultados EM CORRIDA — o primeiro a responder vence.
 *
 * Medido em produção: `gateway.pinata.cloud` levava 3,8s por leitura,
 * enquanto `ipfs.io` respondia em 460ms e `dweb.link` em 896ms. Como o claim
 * faz várias leituras encadeadas, isso sozinho colocava a operação em ~50s —
 * perto do limite de execução da função e uma eternidade para quem espera na
 * tela.
 *
 * Correr entre gateways é seguro por construção: o conteúdo é endereçado
 * pelo hash, então ou o gateway devolve exatamente o mesmo JSON, ou não
 * devolve nada. Não existe "resposta divergente" a ser escolhida.
 */
const GATEWAYS = [
  'https://ipfs.io/ipfs/',
  'https://dweb.link/ipfs/',
  'https://gateway.pinata.cloud/ipfs/',
];

const GATEWAY_TIMEOUT_MS = 8000;

async function fetchPinContent(hash, fallback) {
  if (!hash) return fallback;

  const tentativas = GATEWAYS.map(async (base) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), GATEWAY_TIMEOUT_MS);
    try {
      const r = await fetch(base + hash, { signal: ctrl.signal });
      if (!r.ok) throw new Error(`${base} devolveu ${r.status}`);
      return await r.json();
    } finally {
      clearTimeout(timer);
    }
  });

  try {
    // `any` resolve no primeiro SUCESSO; os lentos e os que falham são
    // ignorados. `race` seria errado aqui — bastaria um gateway falhar
    // rápido para derrubar a leitura inteira.
    const content = await Promise.any(tentativas);
    return content ?? fallback;
  } catch {
    // Todos falharam.
    return fallback;
  }
}

async function getLatestPinWithHash(jwt, name, fallback) {
  try {
    const row = await fetchLatestPinRow(jwt, name);
    let hash = row?.ipfs_pin_hash || null;

    // Se gravamos algo que o pinList ainda não mostra, o nosso é o atual.
    // Sem isto, a leitura devolve o estado ANTERIOR à nossa própria escrita.
    const nosso = ultimoHashGravado.get(name);
    if (nosso && nosso !== hash) {
      const conhecido = await fetchPinContent(nosso, null);
      if (conhecido != null) hash = nosso;
    }

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

/**
 * Igual a `getLatestPin`, mas FALHA em vez de devolver o fallback quando não
 * consegue ler.
 *
 * `getLatestPin` engolir o erro é o comportamento certo pra exibição: o feed
 * mostrando zero curtidas porque o gateway piscou é irrelevante. Mas quando a
 * leitura DECIDE UM PAGAMENTO, o fallback vazio é perigoso — "não consegui
 * ler o histórico" ficaria indistinguível de "nunca paguei nada", e o cron
 * de premiação pagaria o pódio de novo, ou o claim liberaria um resgate que
 * já foi feito.
 *
 * Regra: leitura que resulta em transferência de SOL ou mint pago pela
 * treasury usa esta versão. Leitura que só preenche tela usa a outra.
 */
export async function getLatestPinStrict(jwt, name, fallback) {
  const row = await fetchLatestPinRow(jwt, name);

  // `fetchLatestPinRow` devolve null tanto pra "coleção ainda não existe"
  // quanto pra "a API respondeu erro". Distinguir exige olhar a resposta.
  if (row === null) {
    const q = `https://api.pinata.cloud/data/pinList?status=pinned&pageLimit=1&metadata[name]=${encodeURIComponent(name)}`;
    const r = await fetch(q, { headers: { Authorization: `Bearer ${jwt}` } });
    if (!r.ok) throw new Error(`Leitura de "${name}" falhou: ${r.status}`);

    // A API respondeu bem e não há linhas. Mesmo assim, se nós gravamos algo
    // que o pinList ainda não indexou, esse é o estado real — devolver o
    // fallback aqui seria dizer "nunca claimou" sobre quem acabou de claimar.
    const nosso = ultimoHashGravado.get(name);
    if (nosso) {
      const conhecido = await fetchPinContent(nosso, null);
      if (conhecido != null) return conhecido;
    }
    return fallback;
  }

  // Mesma preferência pelo que gravamos, quando o pinList está atrasado.
  let hash = row.ipfs_pin_hash;
  const nosso = ultimoHashGravado.get(name);
  if (nosso && nosso !== hash) {
    const conhecido = await fetchPinContent(nosso, null);
    if (conhecido != null) hash = nosso;
  }

  const content = await fetchPinContent(hash, fallback);
  return content ?? fallback;
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
    const hash = data?.IpfsHash || null;
    // Registra o que acabamos de gravar, para a próxima leitura não depender
    // da propagação do pinList (ver o comentário de ultimoHashGravado).
    if (hash) ultimoHashGravado.set(name, hash);
    return hash;
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
    let currentHash = latestRow?.ipfs_pin_hash || null;

    // Mesma correção da leitura: o pinList atrasado faria a verificação
    // comparar contra um hash anterior ao nosso e concluir, erradamente,
    // que ninguém escreveu no meio.
    const nosso = ultimoHashGravado.get(name);
    if (nosso && nosso !== currentHash) currentHash = nosso;

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
