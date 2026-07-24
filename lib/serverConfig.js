/**
 * lib/serverConfig.js
 * Verificação das credenciais do servidor.
 *
 * POR QUE ISTO EXISTE: quando o Pinata ou a treasury não estão configurados,
 * o claim falhava com "Não foi possível concluir o resgate. Tente de novo."
 * — uma mensagem que descreve o efeito e esconde a causa. Pior: ela sugere
 * uma ação (tentar de novo) que NUNCA vai funcionar, porque o problema não é
 * transitório. O usuário fica preso tentando, e quem opera o app não recebe
 * nenhum sinal do que está errado.
 *
 * Falha de configuração e falha transitória exigem respostas diferentes.
 * Estas funções permitem distinguir as duas antes de tentar a operação.
 *
 * SERVIDOR APENAS.
 */

/** Um valor de env var que é claramente placeholder e não credencial. */
function ehPlaceholder(valor) {
  if (!valor) return true;
  return /^(COLE|SEU|SUA|YOUR|PASTE|TODO|xxx+|\.\.\.)/i.test(valor.trim()) ||
         /_AQUI$|_HERE$/i.test(valor.trim());
}

/**
 * @returns {{ ok: boolean, faltando: string[], detalhe: string }}
 */
export function checkServerConfig({ precisaTreasury = false } = {}) {
  const faltando = [];

  if (ehPlaceholder(process.env.PINATA_JWT)) faltando.push('PINATA_JWT');
  if (ehPlaceholder(process.env.HELIUS_API_KEY)) faltando.push('HELIUS_API_KEY');

  if (precisaTreasury) {
    const secret = process.env.TREASURY_SECRET_KEY;
    if (ehPlaceholder(secret)) faltando.push('TREASURY_SECRET_KEY');
    else {
      // Chave presente mas malformada é tão fatal quanto ausente, e o erro
      // só apareceria lá na frente, no meio da transferência.
      try {
        const bs58 = require('bs58');
        const bytes = bs58.decode(secret.trim());
        if (bytes.length !== 64) faltando.push('TREASURY_SECRET_KEY (tamanho inválido)');
      } catch {
        faltando.push('TREASURY_SECRET_KEY (não é base58)');
      }
    }
  }

  return {
    ok: faltando.length === 0,
    faltando,
    detalhe: faltando.length ? `Variáveis ausentes ou com placeholder: ${faltando.join(', ')}` : '',
  };
}

/**
 * Responde 503 com mensagem acionável se a configuração estiver incompleta.
 * @returns {boolean} true se JÁ RESPONDEU (o handler deve retornar)
 */
export function guardServerConfig(res, opts) {
  const c = checkServerConfig(opts);
  if (c.ok) return false;

  // O log traz o detalhe técnico para quem opera; a resposta ao usuário diz
  // que o problema é do serviço e que tentar de novo não resolve.
  console.error('[config]', c.detalhe);

  res.status(503).json({
    error: 'O serviço está sem configuração no servidor. Isto não é um problema da sua carteira — avise quem administra o app.',
    configIncompleta: true,
    // Só os NOMES das variáveis, nunca os valores.
    faltando: c.faltando,
  });
  return true;
}
