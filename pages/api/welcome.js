/**
 * pages/api/welcome.js
 * GET  /api/welcome?wallet=…  → se a carteira pode receber as boas-vindas
 * POST /api/welcome           → envia o SOL da primeira arte
 *
 * POR QUE ISTO EXISTE: o claim diário exige uma arte registrada, e registrar
 * uma arte custa SOL. Quem chega com a carteira vazia fica preso — não pode
 * registrar sem SOL, não recebe SOL sem ter registrado. Este endpoint quebra
 * o ciclo, uma única vez por carteira.
 *
 * A liberação exige o PERFIL COMPLETO (nome + bio). É a única barreira que
 * temos contra automação neste ponto: preencher dois campos é trivial para
 * quem é real e é atrito de verdade para quem cria mil carteiras. Não é
 * prova de humanidade — nada aqui é — mas é o que dá para exigir sem
 * empurrar o usuário legítimo para fora.
 */

import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { getLatestPin, getLatestPinStrict, mutatePin, MutationAbort } from '../../lib/pinataStore';
import { CLAIMS, PROFILES, FAUCET_LEDGER } from '../../lib/collections';
import { rateLimit, clientIp } from '../../lib/rateLimit';
import { guardServerConfig } from '../../lib/serverConfig';
import { SOLANA_ADDR_RE } from '../../lib/social/profile';
import { buildWelcomeMessage } from '../../lib/social/welcomeSignature';
import { emptyClaimState } from '../../lib/social/claim';
import { readClaimState } from '../../lib/anchor/onchainClaim';
import { getTreasuryBalance, transferFromTreasury, heliusRpcUrl } from '../../lib/treasury';
/**
 * A Vercel corta funções em 10s por padrão. Esta rota espera a confirmação
 * de uma transação na Solana, o que pode passar disso — e o corte acontece
 * DEPOIS de o SOL já ter saído: o usuário vê erro, mas foi pago. Pior, a
 * resposta cortada vem em HTML, e o cliente quebra ao tentar lê-la como JSON.
 */
export const config = { maxDuration: 60 };

import {
  LAMPORTS_PER_SOL, WELCOME_CLAIM_SOL,
  DAILY_TREASURY_BUDGET_SOL, TREASURY_RESERVE_SOL,
} from '../../lib/config';

const SIGNATURE_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT = 4;
const RATE_WINDOW_MS = 30 * 60 * 1000;

/** Mínimos do cadastro. Não são grandes de propósito: o objetivo é filtrar
 *  automação, não escrever uma biografia. */
const MIN_HANDLE = 2;
const MIN_BIO = 10;

const asMap = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

function verificarAssinatura({ wallet, timestamp, signature }) {
  try {
    const sigBytes = Buffer.from(signature, 'base64');
    if (sigBytes.length !== 64) return false;
    const pubkeyBytes = bs58.decode(wallet);
    if (pubkeyBytes.length !== 32) return false;
    const message = buildWelcomeMessage({ wallet, timestamp });
    return nacl.sign.detached.verify(new TextEncoder().encode(message), sigBytes, pubkeyBytes);
  } catch {
    return false;
  }
}

/** O cadastro está completo? */
function cadastroCompleto(profile) {
  const handle = (profile?.handle || '').trim();
  const bio = (profile?.bio || '').trim();
  return handle.length >= MIN_HANDLE && bio.length >= MIN_BIO;
}

/**
 * Situação da carteira quanto às boas-vindas.
 *
 * `welcomeAt` continua off-chain: as boas-vindas são um pagamento da keypair
 * do projeto, não do cofre do programa, e existem justamente para quem ainda
 * não consegue assinar transação nenhuma por falta de saldo.
 *
 * Já o "esta carteira usa o claim diário?" precisa vir da CHAIN — depois da
 * migração, o pin CLAIMS só guarda o histórico anterior, e usá-lo faria todo
 * usuário novo parecer estreante mesmo depois de resgatar no contrato.
 */
function situacao(claimState, profile, onChainClaims = 0) {
  const jaRecebeu = !!claimState?.welcomeAt;
  const jaClaimou = (claimState?.totalClaims || 0) > 0 || onChainClaims > 0;
  const perfilOk = cadastroCompleto(profile);

  return {
    // Quem já usa o claim diário não precisa das boas-vindas.
    elegivel: !jaRecebeu && !jaClaimou && perfilOk,
    jaRecebeu,
    jaClaimou,
    perfilCompleto: perfilOk,
    valorSol: WELCOME_CLAIM_SOL,
    // Diz o que falta, em vez de só negar.
    pendencia: jaRecebeu ? 'ja-recebeu'
      : jaClaimou ? 'ja-usa-o-claim-diario'
      : !perfilOk ? 'perfil-incompleto'
      : null,
  };
}

export default async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');

  const jwt = process.env.PINATA_JWT;
  if (!jwt) return res.status(500).json({ error: 'Servidor não configurado.' });
  if (guardServerConfig(res, { precisaTreasury: req.method === 'POST' })) return;

  const wallet = req.method === 'GET'
    ? (typeof req.query.wallet === 'string' ? req.query.wallet.trim() : '')
    : (typeof req.body?.wallet === 'string' ? req.body.wallet.trim() : '');

  if (!SOLANA_ADDR_RE.test(wallet)) {
    return res.status(400).json({ error: 'Endereço de carteira inválido.' });
  }

  // ── GET ──────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const [claims, profiles, onChain] = await Promise.all([
        getLatestPin(jwt, CLAIMS, {}),
        getLatestPin(jwt, PROFILES, {}),
        // Tolerante na leitura de tela: sem chain, o card aparece e o POST
        // reconfere antes de pagar qualquer coisa.
        readClaimState(heliusRpcUrl(), wallet).catch(() => null),
      ]);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(
        situacao(asMap(claims)[wallet], asMap(profiles)[wallet], onChain?.totalClaims || 0)
      );
    } catch (err) {
      console.error('[/api/welcome GET]', err.message);
      return res.status(500).json({ error: 'Erro ao consultar as boas-vindas.' });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── POST ─────────────────────────────────────────────────────────────────
  const limite = rateLimit(`welcome:${clientIp(req)}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!limite.ok) {
    res.setHeader('Retry-After', Math.ceil(limite.retryAfterMs / 1000));
    return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' });
  }

  const timestamp = req.body?.timestamp;
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) ||
      Math.abs(Date.now() - timestamp) > SIGNATURE_WINDOW_MS) {
    return res.status(400).json({ error: 'Autorização expirada. Tente de novo.' });
  }
  if (typeof req.body?.signature !== 'string' || !req.body.signature) {
    return res.status(401).json({ error: 'Assinatura da carteira ausente.' });
  }
  if (!verificarAssinatura({ wallet, timestamp, signature: req.body.signature })) {
    return res.status(401).json({ error: 'Assinatura inválida — a carteira não autorizou.' });
  }

  const lamports = Math.round(WELCOME_CLAIM_SOL * LAMPORTS_PER_SOL);
  let reservou = false;

  try {
    // Leitura ESTRITA: é ela que decide se já pagamos. Um resultado vazio
    // por falha de rede seria lido como "nunca recebeu" e pagaria de novo.
    // A leitura on-chain entra estrita aqui, sem `.catch`: ela decide se
    // pagamos, e "não consegui ler" não pode virar "nunca claimou".
    const [claims, profiles, onChain] = await Promise.all([
      getLatestPinStrict(jwt, CLAIMS, {}),
      getLatestPinStrict(jwt, PROFILES, {}),
      readClaimState(heliusRpcUrl(), wallet),
    ]);

    const estado = asMap(claims)[wallet] || emptyClaimState(wallet);
    const perfil = asMap(profiles)[wallet];
    const s = situacao(estado, perfil, onChain?.totalClaims || 0);

    if (!s.elegivel) {
      const mensagens = {
        'ja-recebeu': 'Você já recebeu o SOL de boas-vindas.',
        'ja-usa-o-claim-diario': 'Você já usa o claim diário — as boas-vindas são só para o primeiro acesso.',
        'perfil-incompleto': `Complete seu perfil (nome e uma bio de pelo menos ${MIN_BIO} caracteres) para receber o SOL da primeira arte.`,
      };
      return res.status(403).json({ error: mensagens[s.pendencia] || 'Não elegível.', ...s });
    }

    // Teto diário — as boas-vindas saem do mesmo orçamento do faucet.
    const dia = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const ledger = await getLatestPinStrict(jwt, FAUCET_LEDGER, {});
    const gastoHoje = Number(asMap(ledger)[dia] || 0);
    const teto = Math.round(DAILY_TREASURY_BUDGET_SOL * LAMPORTS_PER_SOL);

    if (gastoHoje + lamports > teto) {
      return res.status(503).json({ error: 'O faucet do dia se esgotou. Tente amanhã.' });
    }

    const saldo = await getTreasuryBalance();
    if (saldo - lamports < Math.round(TREASURY_RESERVE_SOL * LAMPORTS_PER_SOL)) {
      return res.status(503).json({ error: 'A carteira do projeto está sem saldo no momento.' });
    }

    // RESERVA antes de transferir — mesma disciplina do claim diário
    // (pages/api/claim.js): transferência não é reversível, e uma queda entre
    // transferir e gravar deixaria o benefício disponível de novo.
    const reserva = await mutatePin(jwt, CLAIMS, {}, (raw) => {
      const mapa = asMap(raw);
      const atual = mapa[wallet] || emptyClaimState(wallet);
      if (atual.welcomeAt) throw new MutationAbort({ error: 'Você já recebeu o SOL de boas-vindas.', code: 403 });

      return {
        data: { ...mapa, [wallet]: { ...atual, wallet, welcomeAt: Date.now(), welcomePending: true } },
        result: { anterior: mapa[wallet] || null },
      };
    });

    if (reserva.aborted) {
      const p = reserva.payload || {};
      return res.status(p.code || 403).json({ error: p.error });
    }
    if (!reserva.ok) return res.status(502).json({ error: 'Não foi possível iniciar. Tente de novo.' });
    reservou = true;

    const anterior = reserva.result.anterior;

    await mutatePin(jwt, FAUCET_LEDGER, {}, (raw) => {
      const mapa = asMap(raw);
      return { data: { ...mapa, [dia]: Number(mapa[dia] || 0) + lamports }, result: { ok: true } };
    });

    const signature = await transferFromTreasury({
      toWallet: wallet,
      lamports,
      memo: 'urban-boas-vindas',
    });

    // Confirma: tira o pending e registra a assinatura.
    await mutatePin(jwt, CLAIMS, {}, (raw) => {
      const mapa = asMap(raw);
      const atual = mapa[wallet] || emptyClaimState(wallet);
      const { welcomePending, ...limpo } = atual;
      return {
        data: { ...mapa, [wallet]: { ...limpo, welcomeSignature: signature } },
        result: { ok: true },
      };
    });

    return res.status(200).json({
      ok: true,
      signature,
      amountSol: WELCOME_CLAIM_SOL,
    });

  } catch (err) {
    console.error('[/api/welcome POST]', err.message);

    if (reservou) {
      // Desfaz a reserva: o SOL não saiu, então o benefício continua devido.
      await mutatePin(jwt, CLAIMS, {}, (raw) => {
        const mapa = asMap(raw);
        const atual = mapa[wallet];
        if (!atual?.welcomePending) return { data: mapa, result: { ok: true } };
        const { welcomeAt, welcomePending, ...limpo } = atual;
        return { data: { ...mapa, [wallet]: limpo }, result: { ok: true } };
      }).catch(e => console.error('[/api/welcome] rollback falhou:', e.message));
    }

    const ehArmazenamento = /Leitura de|save-failed|pinata|401|403/i.test(err.message || '');
    return res.status(ehArmazenamento ? 503 : 500).json({
      error: ehArmazenamento
        ? 'O serviço de dados está indisponível agora. Tente daqui a pouco.'
        : 'Não foi possível concluir. Tente de novo.',
    });
  }
}
