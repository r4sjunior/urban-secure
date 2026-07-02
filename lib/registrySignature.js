/**
 * lib/registrySignature.js
 * Mensagem assinada pela wallet do artista para provar autoria de um registro
 * em POST /api/registry. Usada tanto pelo cliente (assina) quanto pela API (verifica) —
 * precisa gerar bytes idênticos nos dois lados.
 */
export function buildRegistryMessage({ id, artistWallet, timestamp }) {
  return (
    `Urban Secure — Registrar Arte\n\n` +
    `Confirmo que estou registrando esta obra com minha carteira.\n\n` +
    `Mint: ${id}\n` +
    `Artista: ${artistWallet}\n` +
    `Timestamp: ${timestamp}`
  );
}
