/**
 * lib/treasury.js
 * Carteira do projeto na devnet: paga os claims diários e os prêmios do
 * ranking semanal, e é a autoridade que minta as figurinhas.
 *
 * SERVIDOR APENAS — nunca importar isto de um componente client-side.
 * Requer TREASURY_SECRET_KEY (keypair Solana de 64 bytes em base58, mesmo
 * formato de MARKETPLACE_VAULT_SECRET_KEY). É a mesma estrutura de
 * lib/vaultSigner.js, mas com um papel diferente: a vault CUSTODIA NFTs de
 * terceiros durante uma venda, a treasury PAGA do próprio saldo. Manter as
 * duas separadas significa que vazar uma não compromete a outra, e que o
 * saldo do faucet nunca é confundido com obra em custódia.
 */
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { LAMPORTS_PER_SOL } from './config';

function getSecretKeyBytes() {
  const raw = process.env.TREASURY_SECRET_KEY;
  if (!raw) throw new Error('TREASURY_SECRET_KEY ausente no ambiente da função.');
  const bytes = bs58.decode(raw.trim());
  if (bytes.length !== 64) {
    throw new Error('TREASURY_SECRET_KEY inválida (esperado keypair de 64 bytes em base58).');
  }
  return bytes;
}

export function heliusRpcUrl() {
  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) throw new Error('HELIUS_API_KEY ausente no ambiente da função.');
  const network = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet';
  const cluster = network === 'mainnet-beta' ? 'mainnet' : 'devnet';
  return `https://${cluster}.helius-rpc.com/?api-key=${apiKey}`;
}

/** Endereço público da treasury — seguro de expor ao cliente. */
export function getTreasuryAddress() {
  const { publicKey } = nacl.sign.keyPair.fromSecretKey(getSecretKeyBytes());
  return bs58.encode(publicKey);
}

async function rpc(method, params) {
  const r = await fetch(heliusRpcUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const json = await r.json();
  if (json?.error) throw new Error(`RPC ${method}: ${json.error.message || 'erro'}`);
  return json?.result;
}

/** Saldo atual da treasury em lamports. */
export async function getTreasuryBalance() {
  const result = await rpc('getBalance', [getTreasuryAddress(), { commitment: 'confirmed' }]);
  return Number(result?.value ?? 0);
}

export async function getTreasuryBalanceSol() {
  return (await getTreasuryBalance()) / LAMPORTS_PER_SOL;
}

/**
 * Envia uma transação arbitrária assinada pela treasury.
 *
 * Existe porque a treasury deixou de ser só "quem transfere SOL": com o
 * programa `urban_social` no ar, ela é a AUTHORITY do cofre on-chain e precisa
 * assinar instruções do programa (init_treasury, fund_treasury,
 * pay_weekly_prize). Extrair o envio de `transferFromTreasury` evita uma
 * terceira cópia da mesma dança de blockhash + polling.
 *
 * A confirmação é por polling HTTP pelo motivo de sempre: a Vercel não faz
 * upgrade de WebSocket em API routes, então `confirmTransaction()` nunca
 * resolveria.
 *
 * @param {object} opts
 * @param {Array}  opts.instructions instruções já montadas
 * @param {string} [opts.memo]       nota de auditoria gravada on-chain
 * @returns {Promise<string>} assinatura confirmada
 */
export async function sendFromTreasury({ instructions, memo }) {
  if (!Array.isArray(instructions) || instructions.length === 0) {
    throw new Error('Nenhuma instrução para enviar.');
  }

  const {
    Connection, PublicKey, Transaction,
    ComputeBudgetProgram, Keypair, TransactionInstruction,
  } = await import('@solana/web3.js');

  const keypair = Keypair.fromSecretKey(getSecretKeyBytes());
  const connection = new Connection(heliusRpcUrl(), {
    commitment: 'confirmed',
    disableRetryOnRateLimit: true,
  });

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');

  const tx = new Transaction({ feePayer: keypair.publicKey, blockhash, lastValidBlockHeight })
    .add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 200000 }), ...instructions);

  if (memo) {
    tx.add(new TransactionInstruction({
      keys: [],
      programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
      data: Buffer.from(String(memo).slice(0, 180), 'utf8'),
    }));
  }

  tx.sign(keypair);

  // `skipPreflight: false` aqui, ao contrário de transferFromTreasury: estas
  // instruções passam pelo programa, e a simulação é o que transforma uma
  // violação de `require!` (ex.: prêmio já pago nesta semana) em erro legível
  // no log em vez de uma transação que gasta taxa para reverter.
  const signature = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 5,
  });

  for (let i = 0; i < 20; i++) {
    const status = await connection.getSignatureStatus(signature, { searchTransactionHistory: true });
    const s = status?.value;
    if (s) {
      if (s.err) throw new Error('A transação da treasury falhou ao confirmar.');
      if (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized') {
        return signature;
      }
    }
    await new Promise(r => setTimeout(r, 1500));
  }

  throw new Error('Não foi possível confirmar a transação da treasury.');
}

/**
 * Transfere SOL da treasury para `toWallet` e devolve a assinatura confirmada.
 * Usado pelo claim diário e pela premiação semanal.
 *
 * Assim como em lib/vaultSigner.js e lib/mint.js: envia com send() e confirma
 * por polling HTTP, porque o confirm() da UMI/web3.js depende de WebSocket e
 * a Vercel não faz upgrade de WS em API routes — a espera nunca resolveria.
 *
 * @param {object}  opts
 * @param {string}  opts.toWallet  endereço destino (base58)
 * @param {number}  opts.lamports  quantia a transferir
 * @param {string} [opts.memo]     nota gravada on-chain (ex.: "claim dia 3").
 *                                 Vira trilha de auditoria pública do faucet:
 *                                 dá pra reconstruir todo o histórico de
 *                                 pagamentos direto da chain, sem depender do
 *                                 nosso banco off-chain.
 */
export async function transferFromTreasury({ toWallet, lamports, memo }) {
  if (!Number.isInteger(lamports) || lamports <= 0) {
    throw new Error('Quantia inválida na transferência da treasury.');
  }

  const {
    Connection, PublicKey, SystemProgram, Transaction,
    ComputeBudgetProgram, Keypair, TransactionInstruction,
  } = await import('@solana/web3.js');

  let destPk;
  try {
    destPk = new PublicKey(toWallet);
  } catch {
    throw new Error('Endereço de destino inválido.');
  }

  const keypair = Keypair.fromSecretKey(getSecretKeyBytes());
  const rpcUrl = heliusRpcUrl();
  const connection = new Connection(rpcUrl, {
    commitment: 'confirmed',
    disableRetryOnRateLimit: true,
  });

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');

  const tx = new Transaction({ feePayer: keypair.publicKey, blockhash, lastValidBlockHeight }).add(
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 200000 }),
    SystemProgram.transfer({
      fromPubkey: keypair.publicKey,
      toPubkey: destPk,
      lamports,
    })
  );

  if (memo) {
    tx.add(new TransactionInstruction({
      keys: [],
      programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
      data: Buffer.from(String(memo).slice(0, 180), 'utf8'),
    }));
  }

  tx.sign(keypair);

  const signature = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: true,
    maxRetries: 5,
  });

  for (let i = 0; i < 20; i++) {
    const status = await connection.getSignatureStatus(signature, { searchTransactionHistory: true });
    const s = status?.value;
    if (s) {
      if (s.err) throw new Error('Transferência da treasury falhou ao confirmar.');
      if (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized') {
        return signature;
      }
    }
    await new Promise(r => setTimeout(r, 1500));
  }

  throw new Error('Não foi possível confirmar a transferência da treasury.');
}
