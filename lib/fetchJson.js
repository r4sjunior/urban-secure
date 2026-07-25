/**
 * lib/fetchJson.js
 * `fetch` que sempre devolve JSON utilizável — ou um erro com mensagem.
 *
 * POR QUE ISTO EXISTE: `await res.json()` lança quando a resposta não é JSON,
 * e isso acontece com frequência em produção por motivos que não têm nada a
 * ver com a nossa lógica:
 *
 *   - a função excedeu o tempo e a plataforma devolveu uma página de erro
 *   - um proxy ou captive portal interceptou a requisição
 *   - o deploy estava trocando e veio um HTML de manutenção
 *
 * Em todos esses casos o corpo é HTML, o `json()` estoura, e — se o estouro
 * acontecer fora de um try — a aplicação inteira cai com "client-side
 * exception". Foi exatamente o que derrubou a tela do claim.
 *
 * Aqui o erro vira dado: quem chama recebe `{ ok, status, data, error }` e
 * decide o que fazer, em vez de precisar se defender de uma exceção.
 */

/**
 * @returns {Promise<{ ok: boolean, status: number, data: object, error: string|null }>}
 */
export async function fetchJson(url, options) {
  let res;
  try {
    res = await fetch(url, options);
  } catch (err) {
    // Rede indisponível, DNS, CORS, requisição abortada.
    return {
      ok: false,
      status: 0,
      data: {},
      error: 'Sem conexão com o servidor. Verifique sua internet.',
    };
  }

  const texto = await res.text().catch(() => '');

  let data = {};
  if (texto) {
    try {
      data = JSON.parse(texto);
    } catch {
      // Resposta não-JSON. O conteúdo em si não interessa ao usuário — o que
      // importa é distinguir "o servidor recusou" de "o servidor engasgou".
      return {
        ok: false,
        status: res.status,
        data: {},
        error: res.status >= 500 || res.status === 0
          ? 'O servidor não respondeu como esperado. Tente de novo em instantes.'
          : `Resposta inesperada do servidor (${res.status}).`,
      };
    }
  }

  return {
    ok: res.ok,
    status: res.status,
    data,
    error: res.ok ? null : (data.error || `Erro ${res.status}.`),
  };
}
