/**
 * lib/social/claimSignature.js
 * Mensagem assinada pela wallet pra autorizar o claim diário. Usada pelo
 * cliente (assina) e pela API (verifica) — precisa gerar bytes idênticos.
 *
 * A assinatura aqui prova posse da carteira, não impede sybil: gerar
 * carteira é grátis, então quem quiser mil claims assina mil vezes sem
 * esforço. As travas que realmente seguram o faucet são o teto diário e a
 * exigência de arte registrada (lib/config.js). O que a assinatura garante é
 * outra coisa, igualmente necessária: que ninguém dispare o claim de OUTRA
 * pessoa — o que gastaria o claim diário da vítima mandando SOL pra carteira
 * dela num momento que ela não escolheu, quebrando o streak que ela estava
 * planejando.
 */

/**
 * Dia do claim no fuso de Brasília, formato YYYY-MM-DD.
 *
 * Entra na mensagem pra amarrar a assinatura a um dia específico: sem isso,
 * uma assinatura guardada valeria pra qualquer claim futuro, e quem
 * capturasse uma poderia disparar claims da vítima indefinidamente. Com o
 * dia dentro, a assinatura de ontem não serve pro claim de hoje.
 *
 * Usa o mesmo offset fixo de lib/social/weekly.js — o Brasil não tem horário
 * de verão desde 2019, então a conta é direta e determinística nos dois lados.
 */
export function claimDay(ts = Date.now()) {
  const BRT_OFFSET_MS = -3 * 60 * 60 * 1000;
  return new Date(ts + BRT_OFFSET_MS).toISOString().slice(0, 10);
}

export function buildClaimMessage({ wallet, day, timestamp }) {
  return (
    `Urban Secure — Claim Diário\n\n` +
    `Autorizo o resgate do meu claim diário com minha carteira.\n` +
    `Esta ação é gratuita — o SOL vem da carteira do projeto.\n\n` +
    `Carteira: ${wallet}\n` +
    `Dia: ${day}\n` +
    `Timestamp: ${timestamp}`
  );
}
