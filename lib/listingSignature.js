/**
 * lib/listingSignature.js
 * Mensagem assinada pelo vendedor para provar que é o dono de um anúncio ao
 * cancelá-lo. O NFT já está na vault nesse momento, então não dá pra
 * verificar posse on-chain — a assinatura da wallet é a prova de autoria.
 * Usada tanto pelo cliente (assina) quanto pela API (verifica) — precisa
 * gerar bytes idênticos nos dois lados.
 */
export function buildDelistMessage({ mint, seller, timestamp }) {
  return (
    `Urban Secure — Cancelar Anúncio\n\n` +
    `Confirmo que quero cancelar este anúncio e receber o NFT de volta.\n\n` +
    `NFT: ${mint}\n` +
    `Vendedor: ${seller}\n` +
    `Timestamp: ${timestamp}`
  );
}
