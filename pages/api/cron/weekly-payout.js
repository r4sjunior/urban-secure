/**
 * pages/api/cron/weekly-payout.js
 * Premiação semanal — roda toda segunda às 00:10 (Brasília) via Vercel Cron.
 *
 * Paga o pódio da semana que acabou: 1º 0.05 SOL, 2º 50% disso, 3º 30%
 * (lib/config.js). Transferências reais da treasury, com memo, auditáveis
 * na chain.
 *
 * PAGAMENTO ON-CHAIN. O prêmio sai do cofre do programa `urban_social` pela
 * instrução `pay_weekly_prize`, assinada pela treasury (que é a authority do
 * cofre). Não é mais uma transferência simples da keypair.
 *
 * DUAS PROTEÇÕES QUE NÃO SÃO OPCIONAIS:
 *
 * 1. AUTENTICAÇÃO. Sem o header `Authorization: Bearer $CRON_SECRET`,
 *    qualquer pessoa dispararia a premiação por HTTP e drenaria a treasury
 *    repetindo a chamada. A rota é pública por natureza — a Vercel a invoca
 *    pela internet.
 *
 * 2. IDEMPOTÊNCIA, AGORA GARANTIDA PELO RUNTIME. O programa cria a conta
 *    ["payout", semana, posição] com `init`: pagar a mesma posição na mesma
 *    semana uma segunda vez falha porque a conta já existe. Antes isso
 *    dependia de conseguirmos LER o histórico antes de pagar — e uma leitura
 *    que falhava era indistinguível de "nunca paguei". A checagem off-chain
 *    continua aqui, mas como economia de chamadas, não como a defesa.
 */

import { getLatestPin, getLatestPinStrict, mutatePin, MutationAbort } from '../../../lib/pinataStore';
import { REGISTRY, PROFILES, WEEKLY_PAYOUTS } from '../../../lib/collections';
import { previousWeek, rankArtists, weekIdToU32 } from '../../../lib/social/weekly';
import { displayName } from '../../../lib/social/profile';
import { heliusRpcUrl, getTreasuryAddress, sendFromTreasury } from '../../../lib/treasury';
import { payWeeklyPrizeIx, treasuryPda, decodeTreasury } from '../../../lib/anchor/urbanProgram';
import { fetchAccount } from '../../../lib/anchor/rpc';
import { guardOperatorSecret } from '../../../lib/serverAuth';
import {
  WEEKLY_PRIZE_SPLIT, weeklyPrizeLamports,
  TREASURY_RESERVE_SOL, LAMPORTS_PER_SOL,
} from '../../../lib/config';

/**
 * "Já existe" vindo do runtime não é falha — é a idempotência funcionando.
 *
 * Quando o cron reexecuta uma semana já paga, o `init` do PDA de comprovante
 * falha com "already in use". Tratar isso como erro encheria o log de alarme
 * falso e faria a rota devolver 500 para o comportamento correto.
 */
function jaPago(err) {
  const texto = `${err?.message || ''}\n${Array.isArray(err?.logs) ? err.logs.join('\n') : ''}`;
  return /already in use|custom program error: 0x0\b/i.test(texto);
}

export default async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Falha fechado: sem segredo configurado, ninguém paga nada. O contrário
  // seria uma rota de pagamento aberta por esquecimento de env var.
  if (guardOperatorSecret(req, res, 'cron/weekly-payout')) return;

  const jwt = process.env.PINATA_JWT;
  if (!jwt) return res.status(500).json({ error: 'Servidor não configurado.' });

  const week = previousWeek();

  try {
    // O histórico usa a leitura ESTRITA: é ele que decide se já pagamos, e
    // "não consegui ler" não pode virar "nunca paguei" — isso pagaria o
    // pódio duas vezes. Registry e perfis podem usar a leitura tolerante:
    // no pior caso o ranking sai vazio e ninguém recebe indevidamente.
    const [payouts, arts, profiles] = await Promise.all([
      getLatestPinStrict(jwt, WEEKLY_PAYOUTS, []),
      getLatestPin(jwt, REGISTRY, []),
      getLatestPin(jwt, PROFILES, {}),
    ]);

    const history = Array.isArray(payouts) ? payouts : [];

    // Trava de idempotência (ver o topo do arquivo).
    if (history.some(p => p?.week === week.id)) {
      return res.status(200).json({ ok: true, skipped: 'already-paid', week: week.id });
    }

    const ranking = rankArtists(Array.isArray(arts) ? arts : [], week);
    if (ranking.length === 0) {
      // Semana sem nenhuma arte: grava o payout vazio mesmo assim, senão o
      // cron reprocessaria essa semana em toda execução futura.
      await recordPayout(jwt, { week: week.id, paidAt: Date.now(), winners: [] });
      return res.status(200).json({ ok: true, week: week.id, winners: [], note: 'sem participantes' });
    }

    const podium = ranking.slice(0, WEEKLY_PRIZE_SPLIT.length);
    const totalLamports = podium.reduce((sum, _, i) => sum + weeklyPrizeLamports(i), 0);

    // O saldo que importa agora é o do COFRE, não o da keypair: é dele que o
    // programa tira o prêmio. A keypair só paga a taxa da transação.
    const vaultAccount = await fetchAccount(heliusRpcUrl(), treasuryPda());
    if (!vaultAccount || !decodeTreasury(vaultAccount.data)) {
      console.error('[cron/weekly-payout] cofre on-chain não inicializado');
      return res.status(503).json({ error: 'Cofre on-chain não inicializado.', week: week.id });
    }

    const balance = vaultAccount.lamports;
    const reserve = Math.round(TREASURY_RESERVE_SOL * LAMPORTS_PER_SOL);
    if (balance - totalLamports < 0) {
      // Não paga pela metade: um pódio parcialmente premiado é pior que um
      // pagamento adiado, porque não dá pra retomar sem pagar alguém duas
      // vezes. Falha alto e espera o operador recarregar a treasury.
      console.error('[cron/weekly-payout] saldo insuficiente', {
        balance: balance / LAMPORTS_PER_SOL,
        needed: totalLamports / LAMPORTS_PER_SOL,
      });
      return res.status(503).json({ error: 'Saldo insuficiente na treasury.', week: week.id });
    }
    if (balance - totalLamports < reserve) {
      console.warn('[cron/weekly-payout] premiação vai abaixo da reserva — pagando mesmo assim',
        { restante: (balance - totalLamports) / LAMPORTS_PER_SOL });
    }

    const profileMap = profiles && typeof profiles === 'object' ? profiles : {};
    const winners = [];
    const authority = getTreasuryAddress();
    const weekU32 = weekIdToU32(week.id);

    // Sequencial, não em paralelo: transações da mesma carteira em paralelo
    // disputam o mesmo blockhash e algumas falham por duplicidade. São no
    // máximo 3 pagamentos — o ganho de paralelizar não compensa o risco.
    for (let i = 0; i < podium.length; i++) {
      const entry = podium[i];
      const lamports = weeklyPrizeLamports(i);
      if (lamports <= 0) continue;

      const position = i + 1;

      try {
        const signature = await sendFromTreasury({
          instructions: [payWeeklyPrizeIx({
            authority,
            winner: entry.wallet,
            weekId: weekU32,
            position,
            amount: lamports,
          })],
          memo: `urban-premio ${week.id} #${position}`,
        });

        winners.push({
          wallet: entry.wallet,
          handle: displayName(profileMap[entry.wallet], entry.wallet),
          position,
          artsCount: entry.artsCount,
          lamports,
          signature,
        });
      } catch (err) {
        if (jaPago(err)) {
          // O comprovante on-chain já existe: esta posição foi paga numa
          // execução anterior que não chegou a gravar o histórico. Seguir em
          // frente é o certo — repetir só falharia de novo.
          console.warn('[cron/weekly-payout] posição já paga on-chain', week.id, position);
          continue;
        }
        // Um pagamento falhando não impede os outros — quem ficou em 2º não
        // deve perder o prêmio porque a carteira do 1º deu problema. O
        // registro guarda só quem realmente recebeu.
        console.error('[cron/weekly-payout] falha ao pagar', entry.wallet, err.message);
      }
    }

    await recordPayout(jwt, { week: week.id, paidAt: Date.now(), winners });

    console.log('[cron/weekly-payout]', week.id, winners.length, 'pagos');
    return res.status(200).json({ ok: true, week: week.id, winners });
  } catch (err) {
    console.error('[cron/weekly-payout]', err.message);
    return res.status(500).json({ error: 'Erro na premiação.', week: week.id });
  }
}

/** Grava o payout. Reconfere a duplicidade dentro da mutação porque duas
 *  execuções do cron podem se cruzar. */
async function recordPayout(jwt, payout) {
  const mutation = await mutatePin(jwt, WEEKLY_PAYOUTS, [], (raw) => {
    const history = Array.isArray(raw) ? raw : [];
    if (history.some(p => p?.week === payout.week)) {
      throw new MutationAbort({ duplicate: true });
    }
    return { data: [...history, payout], result: { ok: true } };
  });

  if (!mutation.ok && !mutation.aborted) {
    // O SOL já saiu. Sem o registro, o próximo cron pagaria de novo — por
    // isso o log é alto: exige conferência manual.
    console.error('[cron/weekly-payout] PAGOU MAS NÃO REGISTROU', payout.week, payout.winners.map(w => w.signature));
  }
}
