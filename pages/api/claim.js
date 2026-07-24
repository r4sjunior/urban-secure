/**
 * pages/api/claim.js
 * GET  /api/claim?wallet=…  → situação do claim (sem efeito colateral)
 * POST /api/claim           → executa o claim diário
 *
 * O POST move SOL real da treasury. A regra de "pode claimar?" vive em
 * lib/social/claim.js (pura e testada); aqui ficam o I/O e as travas
 * anti-abuso, nesta ordem deliberada — do mais barato pro mais caro:
 *
 *   1. rate limit por IP        (memória, custo zero)
 *   2. assinatura + timestamp   (CPU local)
 *   3. cooldown                 (1 leitura)
 *   4. arte registrada          (1 leitura, já em memória)
 *   5. teto diário do faucet    (1 leitura)
 *   6. saldo da treasury        (1 RPC)
 *   7. reserva atômica          (escrita)
 *   8. transferência            (irreversível)
 *
 * Recusar cedo é o que mantém um ataque em volume barato pra nós: um script
 * em loop nunca chega ao RPC nem à escrita.
 */

import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { getLatestPin, getLatestPinStrict, mutatePin, MutationAbort } from '../../lib/pinataStore';
import { CLAIMS, REGISTRY, FAUCET_LEDGER } from '../../lib/collections';
import { rateLimit, clientIp } from '../../lib/rateLimit';
import { guardServerConfig } from '../../lib/serverConfig';
import { buildClaimMessage, claimDay } from '../../lib/social/claimSignature';
import { evaluateClaim, emptyClaimState, applyClaim, reserveClaim } from '../../lib/social/claim';
import { SOLANA_ADDR_RE } from '../../lib/social/profile';
import { hasRegisteredArt } from '../../lib/social/hasRegisteredArt';
import { getTreasuryBalance, transferFromTreasury } from '../../lib/treasury';
import {
  LAMPORTS_PER_SOL,
  DAILY_TREASURY_BUDGET_SOL,
  TREASURY_RESERVE_SOL,
  REQUIRE_ART_BEFORE_FIRST_CLAIM,
} from '../../lib/config';

const SIGNATURE_WINDOW_MS = 10 * 60 * 1000;

// 5 tentativas por IP a cada 10 min. Um usuário legítimo faz 1 por dia; esta
// folga cobre só retentativa por erro de rede.
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 10 * 60 * 1000;

// Entradas do ledger mais antigas que isto são descartadas na escrita. Só o
// dia corrente importa pro teto; o resto é histórico que faria o pin crescer
// pra sempre.
const LEDGER_RETENTION_DAYS = 30;

function verifyClaimSignature({ wallet, day, timestamp, signature }) {
  try {
    const sigBytes = Buffer.from(signature, 'base64');
    if (sigBytes.length !== 64) return false;
    const pubkeyBytes = bs58.decode(wallet);
    if (pubkeyBytes.length !== 32) return false;
    const message = buildClaimMessage({ wallet, day, timestamp });
    return nacl.sign.detached.verify(
      new TextEncoder().encode(message), sigBytes, pubkeyBytes
    );
  } catch {
    return false;
  }
}

async function getClaims(jwt) {
  const raw = await getLatestPin(jwt, CLAIMS, {});
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

/**
 * Versão que FALHA se não conseguir ler, usada no POST.
 *
 * No GET, uma leitura que falha só mostra o botão errado por alguns
 * segundos. No POST, ela decide se transferimos SOL: um `{}` vindo de erro
 * de rede seria lido como "esta carteira nunca claimou" e liberaria um
 * resgate que já foi pago hoje. O GET pode ser tolerante; o POST não.
 */
async function getClaimsStrict(jwt) {
  const raw = await getLatestPinStrict(jwt, CLAIMS, {});
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

/** Resposta pública do estado do claim — o mesmo shape no GET e no POST, pra
 *  que o cliente atualize a UI sem precisar de um segundo request. */
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
  };
}

export default async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');

  const jwt = process.env.PINATA_JWT;
  if (!jwt) return res.status(500).json({ error: 'Servidor não configurado.' });

  // Confere a configuração ANTES de tentar qualquer coisa. Sem isto, uma
  // credencial ausente vira um 500 genérico lá na frente, com a mensagem
  // "tente de novo" — que manda o usuário repetir uma ação que não tem como
  // dar certo. O POST exige também a treasury, que é quem paga.
  if (guardServerConfig(res, { precisaTreasury: req.method === 'POST' })) return;

  // ── GET: consulta ────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const wallet = typeof req.query.wallet === 'string' ? req.query.wallet.trim() : '';
    if (!SOLANA_ADDR_RE.test(wallet)) {
      return res.status(400).json({ error: 'Endereço de carteira inválido.' });
    }

    try {
      const claims = await getClaims(jwt);
      const state = claims[wallet] || emptyClaimState(wallet);

      // Sem cache: o cooldown é sensível ao instante e uma resposta de 15s
      // atrás faria o botão aparecer habilitado quando já não está — o
      // usuário assinaria na carteira só pra tomar erro.
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ status: publicStatus(state, Date.now()) });
    } catch (err) {
      console.error('[/api/claim GET]', err.message);
      return res.status(500).json({ error: 'Erro ao consultar o claim.' });
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── POST: executa ────────────────────────────────────────────────────────

  // 1. Rate limit por IP
  const limit = rateLimit(`claim:${clientIp(req)}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!limit.ok) {
    res.setHeader('Retry-After', Math.ceil(limit.retryAfterMs / 1000));
    return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' });
  }

  const body = req.body || {};
  const wallet = typeof body.wallet === 'string' ? body.wallet.trim() : '';

  if (!SOLANA_ADDR_RE.test(wallet)) {
    return res.status(400).json({ error: 'Endereço de carteira inválido.' });
  }

  // 2. Assinatura + timestamp
  const timestamp = body.timestamp;
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) ||
      Math.abs(Date.now() - timestamp) > SIGNATURE_WINDOW_MS) {
    return res.status(400).json({ error: 'Autorização expirada. Tente resgatar de novo.' });
  }
  if (typeof body.signature !== 'string' || !body.signature) {
    return res.status(401).json({ error: 'Assinatura da carteira ausente.' });
  }

  // O dia é derivado do timestamp assinado, não do relógio do servidor: se o
  // request atravessar a virada da meia-noite, o servidor calcularia um dia
  // diferente do que o cliente assinou e recusaria uma autorização legítima.
  const day = claimDay(timestamp);
  if (!verifyClaimSignature({ wallet, day, timestamp, signature: body.signature })) {
    return res.status(401).json({ error: 'Assinatura inválida — a carteira não autorizou este resgate.' });
  }

  let reservedLamports = 0;
  let previousState = null;
  let ledgerReserved = false;

  try {
    const now = Date.now();
    const [claims, arts] = await Promise.all([
      getClaimsStrict(jwt),
      getLatestPin(jwt, REGISTRY, []),
    ]);

    const state = claims[wallet] || emptyClaimState(wallet);
    previousState = claims[wallet] || null;

    // 3. Cooldown
    const ev = evaluateClaim(state, now);
    if (!ev.canClaim) {
      return res.status(429).json({
        error: 'Seu próximo resgate ainda não liberou.',
        status: publicStatus(state, now),
      });
    }

    // 4. Primeira vez exige uma arte registrada.
    //    É a trava anti-sybil mais eficaz: inverte a economia do ataque, já
    //    que registrar uma arte custa SOL do bolso do atacante antes de ele
    //    receber qualquer coisa. Assinatura de carteira não ajudaria aqui —
    //    carteira nova é grátis e instantânea.
    if (REQUIRE_ART_BEFORE_FIRST_CLAIM && (state.totalClaims || 0) === 0) {
      // Consulta o índice E a chain. O índice sozinho recusava usuários
      // legítimos: o registro no Pinata acontece depois do mint, num
      // try/catch que só loga, então a arte pode estar on-chain e fora do
      // índice — e a mensagem culpava o usuário por uma falha nossa.
      // Ver lib/social/hasRegisteredArt.js.
      const temArte = await hasRegisteredArt(arts, wallet);
      if (!temArte) {
        return res.status(403).json({
          error: 'Registre sua primeira arte para liberar o claim diário.',
          needsArt: true,
          status: publicStatus(state, now),
        });
      }
    }

    const lamports = ev.amountLamports;

    // 5. Teto diário do faucet — leitura estrita: um ledger vazio por falha
    //    de rede zeraria o gasto do dia e deixaria o teto ser furado.
    const ledger = await getLatestPinStrict(jwt, FAUCET_LEDGER, {});
    const spentToday = Number(ledger?.[day] || 0);
    const budgetLamports = Math.round(DAILY_TREASURY_BUDGET_SOL * LAMPORTS_PER_SOL);

    if (spentToday + lamports > budgetLamports) {
      return res.status(503).json({
        error: 'O faucet do dia se esgotou. Volte amanhã para manter seu streak.',
        status: publicStatus(state, now),
      });
    }

    // 6. Saldo da treasury, preservando a reserva dos prêmios semanais
    const balance = await getTreasuryBalance();
    const reserveLamports = Math.round(TREASURY_RESERVE_SOL * LAMPORTS_PER_SOL);
    if (balance - lamports < reserveLamports) {
      console.warn('[/api/claim] treasury abaixo da reserva:', balance / LAMPORTS_PER_SOL, 'SOL');
      return res.status(503).json({
        error: 'A carteira do projeto está sem saldo no momento. Tente mais tarde.',
        status: publicStatus(state, now),
      });
    }

    // 7. Reserva atômica — fecha o cooldown ANTES de transferir.
    //    Ver lib/social/claim.js § reserveClaim: transferência não é
    //    reversível, então uma queda entre transferir e gravar precisa
    //    deixar o cooldown FECHADO. No pior caso o usuário perde um claim;
    //    a alternativa seria a treasury pagar duas vezes.
    const reservation = await mutatePin(jwt, CLAIMS, {}, (raw) => {
      const map = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
      const fresh = map[wallet] || emptyClaimState(wallet);

      // Revalida sobre o conteúdo mais recente: entre a leitura lá em cima e
      // esta escrita, outro request do mesmo usuário pode ter passado.
      if (!evaluateClaim(fresh, Date.now()).canClaim) {
        throw new MutationAbort({ reason: 'cooldown' });
      }

      return {
        data: { ...map, [wallet]: reserveClaim(fresh, { wallet, now }) },
        result: { ok: true },
      };
    });

    if (reservation.aborted) {
      return res.status(429).json({
        error: 'Seu próximo resgate ainda não liberou.',
        status: publicStatus(state, now),
      });
    }
    if (!reservation.ok) {
      console.error('[/api/claim] falha ao reservar:', reservation.error);
      return res.status(502).json({ error: 'Não foi possível iniciar o resgate. Tente de novo.' });
    }
    reservedLamports = lamports;

    // Reserva no ledger diário. Contabiliza antes de transferir pelo mesmo
    // motivo: falhar contando a mais só torna o teto mais conservador; falhar
    // contando a menos deixa o teto ser furado.
    const ledgerWrite = await mutatePin(jwt, FAUCET_LEDGER, {}, (raw) => {
      const map = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};

      const cutoff = Date.now() - LEDGER_RETENTION_DAYS * 24 * 60 * 60 * 1000;
      const cutoffDay = claimDay(cutoff);
      const kept = Object.fromEntries(
        Object.entries(map).filter(([d]) => d >= cutoffDay)
      );

      const already = Number(kept[day] || 0);
      if (already + lamports > budgetLamports) {
        throw new MutationAbort({ reason: 'budget' });
      }
      return { data: { ...kept, [day]: already + lamports }, result: { ok: true } };
    });

    if (ledgerWrite.aborted || !ledgerWrite.ok) {
      await rollbackClaim(jwt, wallet, previousState);
      return res.status(503).json({
        error: 'O faucet do dia se esgotou. Volte amanhã para manter seu streak.',
        status: publicStatus(state, now),
      });
    }
    ledgerReserved = true;

    // 8. Transferência (irreversível a partir daqui)
    const signature = await transferFromTreasury({
      toWallet: wallet,
      lamports,
      // O memo transforma a chain em trilha de auditoria do faucet: dá pra
      // reconstruir todo o histórico de pagamentos sem depender do nosso
      // armazenamento off-chain.
      memo: `urban-claim d${ev.nextStreak}`,
    });

    // 9. Confirma o estado definitivo
    const confirmed = applyClaim(state, { wallet, now, lamports, signature });
    const confirmation = await mutatePin(jwt, CLAIMS, {}, (raw) => {
      const map = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
      return { data: { ...map, [wallet]: confirmed }, result: { ok: true } };
    });

    if (!confirmation.ok) {
      // O SOL já saiu. A reserva do passo 7 continua valendo, então o
      // cooldown está fechado e ninguém recebe duas vezes — só o streak e a
      // assinatura ficam sem registrar. Logamos alto porque é o caso que
      // exige conserto manual.
      console.error('[/api/claim] TRANSFERIU MAS NÃO CONFIRMOU', { wallet, signature, lamports });
    }

    return res.status(200).json({
      ok: true,
      signature,
      amountSol: lamports / LAMPORTS_PER_SOL,
      streak: confirmed.currentStreak,
      completedCycle: ev.willCompleteCycle,
      // A figurinha é mintada pela feature de pacotes; aqui só sinalizamos
      // que há um pacote esperando.
      packAvailable: ev.willCompleteCycle,
      status: publicStatus(confirmed, Date.now()),
    });

  } catch (err) {
    console.error('[/api/claim POST]', err.message);

    // Desfaz as reservas se a falha aconteceu ANTES do SOL sair. Se a
    // transferência já tinha confirmado, o erro só pode ter vindo da escrita
    // final, e aí o bloco acima já respondeu — não passamos por aqui.
    if (reservedLamports > 0) {
      await rollbackClaim(jwt, wallet, previousState);
      // Usa o mesmo `day` da escrita, não o de agora: se o request atravessou
      // a meia-noite, devolver o valor no dia errado deixaria o teto de ontem
      // inflado e o de hoje com um crédito que ninguém gastou.
      if (ledgerReserved) await rollbackLedger(jwt, day, reservedLamports);
    }

    // Falha de leitura/escrita no armazenamento não é culpa do usuário e
    // não melhora com insistência — dizer "tente de novo" seria empurrá-lo
    // para um laço. A mensagem separa o que ele pode fazer do que não pode.
    const ehArmazenamento = /Leitura de|save-failed|pinata|401|403/i.test(err.message || '');

    return res.status(ehArmazenamento ? 503 : 500).json({
      error: ehArmazenamento
        ? 'O serviço de dados do app está indisponível agora. Seu streak está seguro — tente daqui a pouco.'
        : 'Não foi possível concluir o resgate. Tente de novo.',
    });
  }
}

/** Devolve o estado do usuário ao que era antes da reserva. */
async function rollbackClaim(jwt, wallet, previousState) {
  try {
    await mutatePin(jwt, CLAIMS, {}, (raw) => {
      const map = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
      const next = { ...map };
      if (previousState) next[wallet] = previousState;
      else delete next[wallet];
      return { data: next, result: { ok: true } };
    });
  } catch (err) {
    // Rollback falhando é aceitável: o efeito é o usuário esperar até o
    // próximo cooldown. Perder um claim é muito melhor que pagar dois.
    console.error('[/api/claim] rollback do estado falhou:', err.message);
  }
}

async function rollbackLedger(jwt, day, lamports) {
  try {
    await mutatePin(jwt, FAUCET_LEDGER, {}, (raw) => {
      const map = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
      const current = Number(map[day] || 0);
      return { data: { ...map, [day]: Math.max(0, current - lamports) }, result: { ok: true } };
    });
  } catch (err) {
    console.error('[/api/claim] rollback do ledger falhou:', err.message);
  }
}
