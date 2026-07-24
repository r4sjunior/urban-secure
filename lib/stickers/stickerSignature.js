/**
 * lib/stickers/stickerSignature.js
 * Mensagens assinadas para ações de figurinha. Usadas pelo cliente (assina)
 * e pela API (verifica) — precisam gerar bytes idênticos nos dois lados.
 *
 * A ação entra na mensagem porque colar é IRREVERSÍVEL e abrir consome um
 * pacote: sem isso, uma assinatura dada para colar valeria para abrir, e o
 * usuário perderia um pacote autorizando outra coisa.
 */

const LABELS = {
  open: 'Abrir Pacote',
  paste: 'Colar Figurinha',
};

export function buildStickerActionMessage({ wallet, action, target, timestamp }) {
  const label = LABELS[action] || action;

  return (
    `Urban Secure — ${label}\n\n` +
    (action === 'paste'
      ? `Confirmo que estou colando esta figurinha no meu álbum.\nColar é permanente.\n\n`
      : `Confirmo a abertura de um pacote de figurinha.\n\n`) +
    `Carteira: ${wallet}\n` +
    (target ? `Figurinha: ${target}\n` : '') +
    `Timestamp: ${timestamp}`
  );
}
