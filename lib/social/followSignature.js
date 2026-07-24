/**
 * lib/social/followSignature.js
 * Mensagem assinada para seguir / deixar de seguir.
 *
 * Seguir é GRÁTIS e sem transação — só uma assinatura, como o login. É uma
 * escolha deliberada: seguir é um gesto de baixo compromisso que a pessoa
 * repete dezenas de vezes numa sessão. Cobrar taxa de rede e esperar
 * confirmação a cada toque mataria a feature — ninguém monta uma rede social
 * pagando por clique.
 *
 * O que é caro fica caro porque tem valor: registrar arte (mint), colar
 * figurinha (permanente), trocar (move NFT). Seguir não é nenhum dos três.
 *
 * A ação entra na mensagem porque seguir e deixar de seguir são operações
 * opostas — uma assinatura dada para uma não pode servir para a outra.
 */

export function buildFollowMessage({ follower, target, action, timestamp }) {
  const verbo = action === 'follow' ? 'seguir' : 'deixar de seguir';

  return (
    `Urban Secure — ${action === 'follow' ? 'Seguir' : 'Deixar de Seguir'}\n\n` +
    `Confirmo que quero ${verbo} este artista.\n` +
    `Esta ação é gratuita e não gera transação na blockchain.\n\n` +
    `Eu: ${follower}\n` +
    `Artista: ${target}\n` +
    `Timestamp: ${timestamp}`
  );
}
