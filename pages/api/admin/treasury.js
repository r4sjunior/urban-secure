/**
 * pages/api/admin/treasury.js
 * Administração do cofre on-chain do programa `urban_social`.
 *
 * O cofre é um PDA de seeds ["treasury"] — uma conta que ninguém controla
 * diretamente. Ela precisa ser criada uma vez (`init`) e abastecida (`fund`)
 * antes de o claim on-chain funcionar; sem isso, todo `claim_daily` falha com
 * "conta não inicializada" e o usuário só vê um erro.
 *
 * POR QUE UMA ROTA E NÃO UM SCRIPT
 *
 * O script teria que carregar o IDL, derivar os PDAs e assinar com a
 * TREASURY_SECRET_KEY fora do Next — ou seja, reimplementar em ESM puro o que
 * `lib/anchor/` já faz para o app. Como rota, roda dentro do mesmo bundle,
 * com as mesmas env vars e a mesma camada de acesso, sem uma segunda cópia
 * capaz de divergir.
 *
 * PROTEÇÃO: `Authorization: Bearer $CRON_SECRET`. Sem isso, um estranho
 * mudaria o teto diário do faucet por HTTP.
 *
 * Uso (com o app rodando):
 *   GET   → estado do cofre
 *   POST  { "action": "init", "dailyBudgetSol": 2 }
 *   POST  { "action": "fund", "sol": 5 }
 *   POST  { "action": "budget", "dailyBudgetSol": 1 }
 */

import { treasuryPda, decodeTreasury, initTreasuryIx, fundTreasuryIx, setDailyBudgetIx, PROGRAM_ID }
  from '../../../lib/anchor/urbanProgram';
import { fetchAccount } from '../../../lib/anchor/rpc';
import { heliusRpcUrl, getTreasuryAddress, getTreasuryBalance, sendFromTreasury } from '../../../lib/treasury';
import { guardOperatorSecret } from '../../../lib/serverAuth';
import { LAMPORTS_PER_SOL, DAILY_TREASURY_BUDGET_SOL } from '../../../lib/config';

export const config = { maxDuration: 60 };

/** Saldo do PDA + campos decodificados, ou `null` se ainda não existe. */
async function readVault() {
  const pda = treasuryPda();
  const account = await fetchAccount(heliusRpcUrl(), pda);
  if (!account) return { address: pda.toBase58(), initialized: false };

  const state = decodeTreasury(account.data);
  return {
    address: pda.toBase58(),
    initialized: true,
    balanceSol: account.lamports / LAMPORTS_PER_SOL,
    authority: state?.authority,
    dailyBudgetSol: (state?.dailyBudget || 0) / LAMPORTS_PER_SOL,
    dailySpentSol: (state?.dailySpent || 0) / LAMPORTS_PER_SOL,
    dailyResetAt: state?.dailyResetAt ? new Date(state.dailyResetAt * 1000).toISOString() : null,
    totalDistributedSol: (state?.totalDistributed || 0) / LAMPORTS_PER_SOL,
  };
}

function solToLamports(value, fallback) {
  const n = typeof value === 'number' ? value : parseFloat(value);
  if (!Number.isFinite(n) || n <= 0) {
    if (fallback == null) return null;
    return Math.round(fallback * LAMPORTS_PER_SOL);
  }
  return Math.round(n * LAMPORTS_PER_SOL);
}

export default async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');

  if (guardOperatorSecret(req, res, 'admin/treasury')) return;

  if (!process.env.TREASURY_SECRET_KEY || !process.env.HELIUS_API_KEY) {
    return res.status(500).json({ error: 'TREASURY_SECRET_KEY ou HELIUS_API_KEY ausente.' });
  }

  try {
    if (req.method === 'GET') {
      const [vault, keypairLamports] = await Promise.all([readVault(), getTreasuryBalance()]);
      return res.status(200).json({
        programId: PROGRAM_ID.toBase58(),
        vault,
        // A keypair NÃO desaparece com o cofre on-chain: ela continua pagando
        // o claim de boas-vindas e mintando as figurinhas, que seguem
        // off-chain. Esvaziá-la quebraria as duas coisas.
        keypair: {
          address: getTreasuryAddress(),
          balanceSol: keypairLamports / LAMPORTS_PER_SOL,
        },
      });
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const action = req.body?.action;
    const vault = await readVault();

    if (action === 'init') {
      if (vault.initialized) {
        return res.status(409).json({ error: 'O cofre já foi inicializado.', vault });
      }
      const dailyBudget = solToLamports(req.body?.dailyBudgetSol, DAILY_TREASURY_BUDGET_SOL);
      const signature = await sendFromTreasury({
        instructions: [initTreasuryIx({ authority: getTreasuryAddress(), dailyBudget })],
        memo: 'urban-treasury init',
      });
      return res.status(200).json({ ok: true, action, signature, vault: await readVault() });
    }

    if (!vault.initialized) {
      return res.status(409).json({ error: 'O cofre ainda não foi inicializado. Rode a ação "init" primeiro.' });
    }

    if (action === 'fund') {
      const amount = solToLamports(req.body?.sol, null);
      if (amount == null) return res.status(400).json({ error: 'Informe "sol" com um valor positivo.' });

      // Confere ANTES de assinar: uma transferência que deixa a keypair sem
      // saldo derruba o claim de boas-vindas e o mint de figurinhas, e não
      // tem volta — o PDA não devolve dinheiro para ninguém, nem para nós.
      const keypairBalance = await getTreasuryBalance();
      const restante = keypairBalance - amount;
      if (restante < 0.5 * LAMPORTS_PER_SOL) {
        return res.status(400).json({
          error: 'Isso deixaria a keypair com menos de 0.5 SOL, e ela ainda paga o claim de boas-vindas e o mint das figurinhas.',
          keypairBalanceSol: keypairBalance / LAMPORTS_PER_SOL,
        });
      }

      const signature = await sendFromTreasury({
        instructions: [fundTreasuryIx({ funder: getTreasuryAddress(), amount })],
        memo: `urban-treasury fund ${amount / LAMPORTS_PER_SOL}`,
      });
      return res.status(200).json({ ok: true, action, signature, vault: await readVault() });
    }

    if (action === 'budget') {
      const dailyBudget = solToLamports(req.body?.dailyBudgetSol, null);
      if (dailyBudget == null) {
        return res.status(400).json({ error: 'Informe "dailyBudgetSol" com um valor positivo.' });
      }
      const signature = await sendFromTreasury({
        instructions: [setDailyBudgetIx({ authority: getTreasuryAddress(), dailyBudget })],
        memo: `urban-treasury budget ${dailyBudget / LAMPORTS_PER_SOL}`,
      });
      return res.status(200).json({ ok: true, action, signature, vault: await readVault() });
    }

    return res.status(400).json({ error: 'Ação inválida. Use "init", "fund" ou "budget".' });
  } catch (err) {
    console.error('[admin/treasury]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
