/**
 * lib/anchor/rpc.js
 * Leitura de contas do programa, isomórfica.
 *
 * `getAccountInfo` é a única chamada RPC que as duas pontas precisam: o
 * cliente para desenhar streak e perfil, o servidor para o GET do claim e para
 * o cron da premiação. Fazer por `fetch` cru em vez de `new Connection(...)`
 * mantém o web3.js fora do bundle de quem só lê — ele só entra quando há uma
 * transação para assinar.
 *
 * A URL difere por lado e isso é proposital: o browser passa pelo proxy
 * `/api/rpc` (que guarda a HELIUS_API_KEY e aplica a allowlist de métodos), o
 * servidor fala direto com o Helius.
 */

/** Endpoint para uso no browser — sempre o proxy, nunca o Helius direto. */
export function browserRpcUrl() {
  return `${window.location.origin}/api/rpc`;
}

/**
 * Lê os dados brutos de uma conta.
 *
 * @param {string} rpcUrl
 * @param {string|object} address endereço base58 ou PublicKey
 * @returns {Promise<{ data: Buffer, lamports: number, owner: string }|null>}
 *   `null` quando a conta não existe — que é o estado normal de quem ainda não
 *   criou perfil ou nunca resgatou, e não uma falha.
 */
export async function fetchAccount(rpcUrl, address) {
  const addr = typeof address === 'string' ? address : address.toBase58();

  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'getAccountInfo',
      params: [addr, { encoding: 'base64', commitment: 'confirmed' }],
    }),
  });

  if (!res.ok) throw new Error(`RPC getAccountInfo: HTTP ${res.status}`);

  const json = await res.json();
  if (json?.error) throw new Error(`RPC getAccountInfo: ${json.error.message || 'erro'}`);

  const value = json?.result?.value;
  if (!value?.data?.[0]) return null;

  return {
    data: Buffer.from(value.data[0], 'base64'),
    lamports: Number(value.lamports || 0),
    owner: value.owner,
  };
}
