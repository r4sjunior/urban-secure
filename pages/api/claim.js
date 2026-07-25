/**
 * pages/api/claim.js
 * GET /api/claim?wallet=…  → situação do claim, lida da chain
 *
 * MIGRADO PARA ON-CHAIN. O resgate agora é a instrução `claim_daily` do
 * programa `urban_social`, assinada pela carteira do usuário — o servidor não
 * participa mais dele. Esta rota virou só leitura.
 *
 * O QUE ISSO ELIMINOU
 *
 * Todo o POST antigo era uma reconstrução, em JavaScript, das garantias que a
 * Solana dá de graça: reserva prévia do cooldown, rollback do estado, rollback
 * do ledger diário e um log de "TRANSFERIU MAS NÃO CONFIRMOU" para o caso em
 * que o processo morria entre a transferência e a escrita. Nada disso existe
 * mais: a transação é atômica, então ou o SOL sai e o streak sobe, ou nada
 * acontece. O teto diário e o saldo mínimo do cofre passaram a ser `require!`
 * dentro do programa.
 *
 * O QUE ISSO CUSTOU — e é honesto registrar
 *
 * A trava "precisa ter registrado uma arte antes do primeiro claim" era
 * aplicada aqui, e era a defesa anti-sybil mais eficaz do app. O programa não
 * a implementa, e como o servidor não assina mais a transação, não há onde
 * impor. Continua valendo como orientação na interface (o campo `needsArt`
 * abaixo), mas quem montar a transação na mão passa por cima. O que limita o
 * prejuízo agora é o teto diário do cofre, aplicado on-chain.
 *
 * O histórico off-chain (o pin CLAIMS no Pinata) NÃO foi apagado — segue
 * disponível em `legacy`, só para exibição. Os streaks recomeçam do zero
 * on-chain porque o programa não tem instrução de importação, e criar uma
 * significaria dar ao operador o poder de escrever qualquer streak — que é
 * exatamente a fraqueza que a migração veio remover.
 */

import { getLatestPin } from '../../lib/pinataStore';
import { CLAIMS, REGISTRY } from '../../lib/collections';
import { guardServerConfig } from '../../lib/serverConfig';
import { evaluateClaim } from '../../lib/social/claim';
import { SOLANA_ADDR_RE } from '../../lib/social/profile';
import { hasRegisteredArt } from '../../lib/social/hasRegisteredArt';
import { readClaimState } from '../../lib/anchor/onchainClaim';
import { treasuryPda, decodeTreasury, PROGRAM_ID } from '../../lib/anchor/urbanProgram';
import { fetchAccount } from '../../lib/anchor/rpc';
import { heliusRpcUrl } from '../../lib/treasury';
import { LAMPORTS_PER_SOL, REQUIRE_ART_BEFORE_FIRST_CLAIM } from '../../lib/config';

/** Resposta pública do estado do claim — mesmo shape que a UI já consome. */
function publicStatus(state, now) {
  const ev = evaluateClaim(state, now);
  return {
    canClaim: ev.canClaim,
    currentStreak: ev.currentStreak,
    nextStreak: ev.nextStreak,
    nextClaimAt: ev.nextClaimAt,
    msUntilNext: ev.msUntilNext,
    streakExpiresAt: ev.streakExpiresAt,
    streakAtRisk: ev.streakAtRisk,
    willCompleteCycle: ev.willCompleteCycle,
    daysToNextPack: ev.daysToNextPack,
    amountSol: ev.amountLamports / LAMPORTS_PER_SOL,
    completedCycles: state?.completedCycles || 0,
    longestStreak: state?.longestStreak || 0,
    totalClaims: state?.totalClaims || 0,
    onChain: !!state?.onChain,
  };
}

/**
 * Estado do cofre. A UI precisa dele para separar dois "não dá pra resgatar"
 * que o usuário não tem como distinguir sozinho: o cooldown dele ainda não
 * venceu, ou o faucet do dia acabou para todo mundo.
 */
async function readVault(rpcUrl) {
  try {
    const account = await fetchAccount(rpcUrl, treasuryPda());
    if (!account) return { ready: false, reason: 'not-initialized' };

    const t = decodeTreasury(account.data);
    if (!t) return { ready: false, reason: 'not-initialized' };

    return {
      ready: true,
      balanceSol: account.lamports / LAMPORTS_PER_SOL,
      dailyBudgetSol: t.dailyBudget / LAMPORTS_PER_SOL,
      dailySpentSol: t.dailySpent / LAMPORTS_PER_SOL,
      // A janela do teto é deslizante: o programa zera `daily_spent` no
      // primeiro claim que acontece 24h depois do último reset. Um valor
      // antigo aqui não significa que o faucet está esgotado.
      dailyResetAt: t.dailyResetAt * 1000,
    };
  } catch (err) {
    console.error('[/api/claim] leitura do cofre falhou:', err.message);
    return { ready: null, reason: 'unreadable' };
  }
}

export default async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'POST') {
    // 410, não 404: a rota existiu e foi removida de propósito. Um cliente
    // antigo em cache que ainda faça POST recebe uma explicação em vez de um
    // erro genérico que o faria tentar de novo para sempre.
    return res.status(410).json({
      error: 'O resgate agora é feito pela sua carteira, direto no contrato. Atualize a página.',
      onChain: true,
      programId: PROGRAM_ID.toBase58(),
    });
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // O GET só lê a chain, mas ainda toca o Pinata para o histórico legado e
  // para a checagem de arte registrada.
  if (guardServerConfig(res, { precisaTreasury: false })) return;

  if (!process.env.HELIUS_API_KEY) {
    return res.status(500).json({ error: 'RPC não configurado.', configIncompleta: true });
  }

  const wallet = typeof req.query.wallet === 'string' ? req.query.wallet.trim() : '';
  if (!SOLANA_ADDR_RE.test(wallet)) {
    return res.status(400).json({ error: 'Endereço de carteira inválido.' });
  }

  const jwt = process.env.PINATA_JWT;
  const rpcUrl = heliusRpcUrl();

  try {
    const [state, vault] = await Promise.all([readClaimState(rpcUrl, wallet), readVault(rpcUrl)]);

    const now = Date.now();
    const status = publicStatus(state, now);

    // Orientação de onboarding, não trava (ver o cabeçalho). Só é consultada
    // para quem ainda não resgatou nenhuma vez on-chain — para os demais é
    // uma leitura desperdiçada.
    let needsArt = false;
    if (REQUIRE_ART_BEFORE_FIRST_CLAIM && status.totalClaims === 0) {
      try {
        const arts = await getLatestPin(jwt, REGISTRY, []);
        needsArt = !(await hasRegisteredArt(Array.isArray(arts) ? arts : [], wallet));
      } catch {
        // Falha de leitura não pode virar um bloqueio na tela: na dúvida,
        // deixa o usuário tentar. O programa é quem decide de verdade.
      }
    }

    // Histórico anterior à migração — puramente informativo. Nunca alimenta
    // `status`, senão o streak antigo reapareceria como se valesse.
    let legacy = null;
    try {
      const claims = await getLatestPin(jwt, CLAIMS, {});
      const old = claims && typeof claims === 'object' ? claims[wallet] : null;
      if (old?.totalClaims) {
        legacy = {
          totalClaims: old.totalClaims || 0,
          longestStreak: old.longestStreak || 0,
          completedCycles: old.completedCycles || 0,
          lastClaimAt: old.lastClaimAt || 0,
        };
      }
    } catch {
      // Histórico é enfeite; falhar em lê-lo não pode derrubar a tela.
    }

    // Sem cache: o cooldown é sensível ao instante e uma resposta de 15s atrás
    // faria o botão aparecer habilitado quando já não está.
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ status, vault, needsArt, legacy });
  } catch (err) {
    console.error('[/api/claim GET]', err.message);
    return res.status(500).json({ error: 'Erro ao consultar o claim.' });
  }
}
