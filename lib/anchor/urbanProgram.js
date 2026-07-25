/**
 * lib/anchor/urbanProgram.js
 * Camada de acesso ao programa `urban_social` na devnet.
 *
 * POR QUE NÃO USAMOS @coral-xyz/anchor
 *
 * O cliente oficial do Anchor traz o pacote inteiro (~500 kB), um `Provider`
 * acoplado ao wallet-adapter e uma versão própria de `@solana/web3.js` que
 * conflita com a 1.98.4 fixada aqui. Em troca, ele nos daria: derivação de
 * PDA, oito bytes de discriminador e serialização Borsh de meia dúzia de
 * campos escalares — que é exatamente o que este arquivo faz em 200 linhas,
 * sem dependência nova e sem entrar no bundle da home.
 *
 * A fonte de verdade continua sendo o IDL (`urban_social.idl.json`), gerado a
 * partir de `programs/urban_social/src/lib.rs`. Os discriminadores vêm de lá,
 * não de constantes soltas: se o programa mudar, o IDL muda junto e este
 * arquivo acompanha.
 *
 * ISOMÓRFICO: roda no cliente (monta transação que o Phantom assina) e no
 * servidor (cron da premiação). Não importe nada de `lib/treasury.js` aqui —
 * este módulo precisa continuar seguro para o bundle do browser.
 */

import { PublicKey, TransactionInstruction, SystemProgram } from '@solana/web3.js';
import IDL from './urban_social.idl.json';

export { IDL };

/**
 * O Program Id vem do ambiente para que devnet e mainnet não exijam recompilar
 * o app. O IDL guarda o mesmo valor e serve de fallback — se os dois
 * divergirem, o do ambiente vence, porque é ele que aponta para o deploy que
 * está no ar.
 */
export const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_URBAN_PROGRAM_ID || IDL.address
);

const ix = (name) => {
  const found = IDL.instructions.find((i) => i.name === name);
  if (!found) throw new Error(`Instrução ausente no IDL: ${name}`);
  return Buffer.from(found.discriminator);
};

const accDisc = (name) => {
  const found = IDL.accounts.find((a) => a.name === name);
  if (!found) throw new Error(`Conta ausente no IDL: ${name}`);
  return Buffer.from(found.discriminator);
};

// ─────────────────────────────────────────────────────────────────────────
// PDAs
//
// As seeds precisam bater BYTE A BYTE com as declaradas no `#[derive(Accounts)]`
// do programa. Um erro aqui não vira exceção clara: a transação falha com
// "seeds constraint violated", que não diz qual seed estava errada.
// ─────────────────────────────────────────────────────────────────────────

const toPk = (v) => (v instanceof PublicKey ? v : new PublicKey(v));

/** PDA do cofre do projeto — seeds ["treasury"]. Existe uma só no programa. */
export function treasuryPda() {
  return PublicKey.findProgramAddressSync([Buffer.from('treasury')], PROGRAM_ID)[0];
}

/** PDA do perfil — seeds ["profile", wallet]. */
export function profilePda(wallet) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('profile'), toPk(wallet).toBuffer()],
    PROGRAM_ID
  )[0];
}

/** PDA do estado de claim/streak — seeds ["claim", wallet]. */
export function claimPda(wallet) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('claim'), toPk(wallet).toBuffer()],
    PROGRAM_ID
  )[0];
}

/**
 * PDA do comprovante de prêmio — seeds ["payout", week_id LE, position].
 *
 * É esta conta que garante a idempotência da premiação: como o programa a cria
 * com `init`, uma segunda tentativa de pagar a mesma posição na mesma semana
 * falha no runtime. O `week_id` vai em little-endian de 4 bytes porque o Rust
 * usa `week_id.to_le_bytes()`.
 */
export function payoutPda(weekId, position) {
  const week = Buffer.alloc(4);
  week.writeUInt32LE(weekId, 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('payout'), week, Buffer.from([position])],
    PROGRAM_ID
  )[0];
}

// ─────────────────────────────────────────────────────────────────────────
// Borsh — só o subconjunto que este programa usa
// ─────────────────────────────────────────────────────────────────────────

const u8 = (n) => Buffer.from([n & 0xff]);

const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n, 0);
  return b;
};

const u64 = (n) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n), 0);
  return b;
};

/** String Borsh: 4 bytes de comprimento (em BYTES, não caracteres) + UTF-8. */
const str = (s) => {
  const bytes = Buffer.from(String(s ?? ''), 'utf8');
  return Buffer.concat([u32(bytes.length), bytes]);
};

/**
 * Struct `Socials`: quatro strings, sempre na mesma ordem do Rust.
 * Campo vazio vira string de tamanho zero — o programa aceita, e é assim que
 * representamos "não informou esta rede".
 */
const socials = (s = {}) =>
  Buffer.concat([str(s.instagram), str(s.x), str(s.tiktok), str(s.farcaster)]);

// Leitura ─────────────────────────────────────────────────────────────────

class Reader {
  constructor(buf) { this.buf = buf; this.pos = 0; }
  u8()  { return this.buf.readUInt8(this.pos++); }
  u32() { const v = this.buf.readUInt32LE(this.pos); this.pos += 4; return v; }
  // Number em vez de BigInt: lamports e timestamps deste app cabem com folga
  // nos 2^53 seguros do JS, e BigInt vazaria para toda a UI.
  u64() { const v = this.buf.readBigUInt64LE(this.pos); this.pos += 8; return Number(v); }
  i64() { const v = this.buf.readBigInt64LE(this.pos);  this.pos += 8; return Number(v); }
  pubkey() { const v = new PublicKey(this.buf.subarray(this.pos, this.pos + 32)); this.pos += 32; return v; }
  str() {
    const len = this.u32();
    const v = this.buf.subarray(this.pos, this.pos + len).toString('utf8');
    this.pos += len;
    return v;
  }
}

const checkDisc = (data, name) => {
  if (!data || data.length < 8) return false;
  return Buffer.from(data.subarray(0, 8)).equals(accDisc(name));
};

// ─────────────────────────────────────────────────────────────────────────
// Instruções
// ─────────────────────────────────────────────────────────────────────────

const SYS = SystemProgram.programId;

/**
 * Resgate diário. O usuário é signatário E pagador: ele paga a taxa de rede e,
 * no primeiro claim, o rent da própria conta de estado (~0.0013 SOL). Não há
 * como o servidor pagar esse rent — o programa declara `payer = user`.
 */
export function claimDailyIx({ user }) {
  const userPk = toPk(user);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: claimPda(userPk), isSigner: false, isWritable: true },
      { pubkey: treasuryPda(),    isSigner: false, isWritable: true },
      { pubkey: userPk,           isSigner: true,  isWritable: true },
      { pubkey: SYS,              isSigner: false, isWritable: false },
    ],
    data: ix('claim_daily'),
  });
}

export function initProfileIx({ owner, handle, bio, avatarCid, socials: s }) {
  const ownerPk = toPk(owner);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: profilePda(ownerPk), isSigner: false, isWritable: true },
      { pubkey: ownerPk,             isSigner: true,  isWritable: true },
      { pubkey: SYS,                 isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([ix('init_profile'), str(handle), str(bio), str(avatarCid), socials(s)]),
  });
}

/** Atualiza o perfil. Sem `system_program`: nenhuma conta é criada aqui. */
export function updateProfileIx({ owner, handle, bio, avatarCid, socials: s }) {
  const ownerPk = toPk(owner);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: profilePda(ownerPk), isSigner: false, isWritable: true },
      { pubkey: ownerPk,             isSigner: true,  isWritable: false },
    ],
    data: Buffer.concat([ix('update_profile'), str(handle), str(bio), str(avatarCid), socials(s)]),
  });
}

/** Premiação semanal. Assinada pela authority da treasury (servidor). */
export function payWeeklyPrizeIx({ authority, winner, weekId, position, amount }) {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: payoutPda(weekId, position), isSigner: false, isWritable: true },
      { pubkey: treasuryPda(),               isSigner: false, isWritable: true },
      { pubkey: toPk(winner),                isSigner: false, isWritable: true },
      { pubkey: toPk(authority),             isSigner: true,  isWritable: true },
      { pubkey: SYS,                         isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([ix('pay_weekly_prize'), u32(weekId), u8(position), u64(amount)]),
  });
}

export function initTreasuryIx({ authority, dailyBudget }) {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: treasuryPda(),   isSigner: false, isWritable: true },
      { pubkey: toPk(authority), isSigner: true,  isWritable: true },
      { pubkey: SYS,             isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([ix('init_treasury'), u64(dailyBudget)]),
  });
}

export function fundTreasuryIx({ funder, amount }) {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: treasuryPda(), isSigner: false, isWritable: true },
      { pubkey: toPk(funder),  isSigner: true,  isWritable: true },
      { pubkey: SYS,           isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([ix('fund_treasury'), u64(amount)]),
  });
}

export function setDailyBudgetIx({ authority, dailyBudget }) {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: treasuryPda(),   isSigner: false, isWritable: true },
      { pubkey: toPk(authority), isSigner: true,  isWritable: false },
    ],
    data: Buffer.concat([ix('set_daily_budget'), u64(dailyBudget)]),
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Decodificação das contas
//
// Todas devolvem `null` quando a conta não existe — que é o estado normal de
// quem nunca claimou ou nunca criou perfil, e não um erro.
// ─────────────────────────────────────────────────────────────────────────

export function decodeClaimState(data) {
  if (!checkDisc(data, 'ClaimState')) return null;
  const r = new Reader(Buffer.from(data));
  r.pos = 8;
  return {
    wallet:          r.pubkey().toBase58(),
    lastClaimAt:     r.i64(),   // segundos — o app trabalha em ms, converta na borda
    currentStreak:   r.u32(),
    longestStreak:   r.u32(),
    completedCycles: r.u32(),
    totalClaims:     r.u32(),
    totalClaimed:    r.u64(),
    bump:            r.u8(),
  };
}

export function decodeTreasury(data) {
  if (!checkDisc(data, 'Treasury')) return null;
  const r = new Reader(Buffer.from(data));
  r.pos = 8;
  return {
    authority:        r.pubkey().toBase58(),
    dailyBudget:      r.u64(),
    dailySpent:       r.u64(),
    dailyResetAt:     r.i64(),
    totalDistributed: r.u64(),
    bump:             r.u8(),
  };
}

export function decodeProfile(data) {
  if (!checkDisc(data, 'Profile')) return null;
  const r = new Reader(Buffer.from(data));
  r.pos = 8;
  const wallet = r.pubkey().toBase58();
  const handle = r.str();
  const bio = r.str();
  const avatarCid = r.str();
  const s = { instagram: r.str(), x: r.str(), tiktok: r.str(), farcaster: r.str() };
  return {
    wallet, handle, bio, avatarCid,
    socials: s,
    createdAt: r.i64(),
    updatedAt: r.i64(),
    bump: r.u8(),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Erros
// ─────────────────────────────────────────────────────────────────────────

/**
 * Traduz a falha de uma transação para a mensagem que o usuário lê.
 *
 * O `require!` do programa devolve um código numérico (6000 + índice do enum);
 * cru, ele chega na tela como "custom program error: 0x1770", que não diz nada
 * a ninguém. As mensagens já estão escritas em português no IDL — usá-las
 * mantém uma única fonte de texto para as duas pontas.
 */
export function parseProgramError(err) {
  const raw = typeof err === 'string' ? err : (err?.message || '');
  const logs = Array.isArray(err?.logs) ? err.logs.join('\n') : '';
  const haystack = `${raw}\n${logs}`;

  // O código aparece em hex ("0x1770") ou decimal, dependendo de onde a falha
  // foi capturada: simulação, envio ou confirmação.
  const hex = haystack.match(/custom program error:\s*0x([0-9a-f]+)/i);
  const dec = haystack.match(/"Custom"\s*:\s*(\d+)/) || haystack.match(/Custom\((\d+)\)/);
  const code = hex ? parseInt(hex[1], 16) : (dec ? parseInt(dec[1], 10) : null);

  if (code != null) {
    const known = IDL.errors.find((e) => e.code === code);
    if (known) return known.msg;
  }

  if (/User rejected|rejected the request|cancel/i.test(haystack)) {
    return 'Autorização cancelada.';
  }
  // Acontece de verdade: o usuário gastou o SOL registrando arte e não sobrou
  // para a taxa. A mensagem genérica ("Transaction simulation failed") mandaria
  // ele tentar de novo para sempre.
  if (/insufficient (lamports|funds)|Attempt to debit an account/i.test(haystack)) {
    return 'Saldo insuficiente na sua carteira para a taxa de rede.';
  }
  if (/blockhash not found|block height exceeded/i.test(haystack)) {
    return 'A transação demorou demais e expirou. Tente de novo.';
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// Parâmetros do programa — espelham as constantes do lib.rs.
//
// Estão aqui porque a UI precisa saber o cooldown e o alvo do streak ANTES de
// enviar qualquer transação (para desenhar a trilha e o contador). Se mudarem
// no Rust, precisam mudar aqui — não há como ler constantes de um programa
// deployado.
// ─────────────────────────────────────────────────────────────────────────

export const ONCHAIN = {
  CLAIM_COOLDOWN_SECS: 20 * 60 * 60,
  STREAK_GRACE_SECS: 48 * 60 * 60,
  STREAK_TARGET: 7,
  DAILY_CLAIM_LAMPORTS: 10_500_000,
};
