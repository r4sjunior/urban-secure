/**
 * pages/api/health.js
 * Diagnóstico de configuração e conectividade.
 *
 * Abra no navegador (local ou em produção) para ver, numa tela, o que está
 * configurado e o que está quebrado. Existe porque "o claim não funciona"
 * pode ser cinco coisas diferentes — credencial ausente, Pinata recusando,
 * RPC fora, treasury sem saldo — e sem um lugar para olhar, descobrir qual
 * delas exige ler log de servidor.
 *
 * NÃO EXPÕE SEGREDO NENHUM: só informa se cada credencial está presente e se
 * funciona. Nomes de variáveis, nunca valores.
 */

import { checkServerConfig } from '../../lib/serverConfig';
import { CLAIMS } from '../../lib/collections';
import {
  LAMPORTS_PER_SOL, DAILY_CLAIM_SOL, ART_MINT_COST_SOL,
  TREASURY_RESERVE_SOL, DAILY_TREASURY_BUDGET_SOL,
} from '../../lib/config';

/** Confere se o Pinata aceita o JWT — presença não é o mesmo que validade. */
async function testarPinata(jwt) {
  if (!jwt) return { ok: false, erro: 'JWT ausente' };
  try {
    const r = await fetch(
      `https://api.pinata.cloud/data/pinList?status=pinned&pageLimit=1&metadata[name]=${encodeURIComponent(CLAIMS)}`,
      { headers: { Authorization: `Bearer ${jwt}` } }
    );
    if (r.status === 401 || r.status === 403) {
      return { ok: false, erro: `credencial recusada (HTTP ${r.status}) — o JWT está inválido ou expirou` };
    }
    if (!r.ok) return { ok: false, erro: `HTTP ${r.status}` };
    const j = await r.json();
    return { ok: true, detalhe: `${j?.rows?.length ?? 0} pin(s) na coleção de claims` };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

async function testarRpc() {
  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) return { ok: false, erro: 'HELIUS_API_KEY ausente' };
  const cluster = (process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet') === 'mainnet-beta' ? 'mainnet' : 'devnet';
  try {
    const r = await fetch(`https://${cluster}.helius-rpc.com/?api-key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
    });
    const j = await r.json();
    if (j?.error) return { ok: false, erro: j.error.message };
    return { ok: true, detalhe: `${cluster} respondendo` };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

async function testarTreasury() {
  try {
    const { getTreasuryAddress, getTreasuryBalance } = await import('../../lib/treasury');
    const address = getTreasuryAddress();
    const lamports = await getTreasuryBalance();
    const sol = lamports / LAMPORTS_PER_SOL;

    // Saldo abaixo da reserva bloqueia o claim — é uma causa comum de
    // "não funciona" que não tem nada a ver com código.
    const reserva = TREASURY_RESERVE_SOL;
    const claimsPossiveis = Math.max(0, Math.floor((sol - reserva) / DAILY_CLAIM_SOL));

    return {
      ok: sol - DAILY_CLAIM_SOL >= reserva,
      address,
      saldoSol: Number(sol.toFixed(6)),
      reservaSol: reserva,
      claimsPossiveis,
      erro: sol - DAILY_CLAIM_SOL < reserva
        ? `saldo (${sol.toFixed(4)}) abaixo da reserva (${reserva}) + valor do claim (${DAILY_CLAIM_SOL}) — o claim vai recusar com 503`
        : undefined,
    };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

export default async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');

  const config = checkServerConfig({ precisaTreasury: true });

  const [pinata, rpc, treasury] = await Promise.all([
    testarPinata(process.env.PINATA_JWT),
    testarRpc(),
    testarTreasury(),
  ]);

  const tudoOk = config.ok && pinata.ok && rpc.ok && treasury.ok;

  const relatorio = {
    ok: tudoOk,
    rede: process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet',

    variaveis: {
      // Só presença e validade de formato. Nunca o valor.
      PINATA_JWT: !config.faltando.includes('PINATA_JWT'),
      HELIUS_API_KEY: !config.faltando.includes('HELIUS_API_KEY'),
      TREASURY_SECRET_KEY: !config.faltando.some(f => f.startsWith('TREASURY_SECRET_KEY')),
      CRON_SECRET: !!process.env.CRON_SECRET,
      MARKETPLACE_VAULT_SECRET_KEY: !!process.env.MARKETPLACE_VAULT_SECRET_KEY,
    },

    servicos: { pinata, rpc, treasury },

    economia: {
      claimDiarioSol: DAILY_CLAIM_SOL,
      custoPorArteSol: ART_MINT_COST_SOL,
      tetoDiarioSol: DAILY_TREASURY_BUDGET_SOL,
      reservaSol: TREASURY_RESERVE_SOL,
    },

    // O que fazer, em ordem. Um diagnóstico que só aponta o defeito deixa
    // metade do trabalho para quem lê.
    proximosPassos: [],
  };

  if (config.faltando.length) {
    relatorio.proximosPassos.push(
      `Configure: ${config.faltando.join(', ')}. Local: .env.local · Produção: painel da Vercel → Settings → Environment Variables (e faça redeploy).`
    );
  }
  if (!pinata.ok && !config.faltando.includes('PINATA_JWT')) {
    relatorio.proximosPassos.push(`Pinata recusou a credencial: ${pinata.erro}. Gere um JWT novo em app.pinata.cloud → API Keys.`);
  }
  if (!rpc.ok) relatorio.proximosPassos.push(`RPC indisponível: ${rpc.erro}. Confira a HELIUS_API_KEY em dashboard.helius.dev.`);
  if (!treasury.ok && treasury.erro) relatorio.proximosPassos.push(`Treasury: ${treasury.erro}`);
  if (tudoOk) relatorio.proximosPassos.push('Tudo configurado. Se o claim ainda falhar, o motivo virá na resposta do /api/claim.');

  return res.status(tudoOk ? 200 : 503).json(relatorio);
}
