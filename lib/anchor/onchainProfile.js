/**
 * lib/anchor/onchainProfile.js
 * Perfil no programa `urban_social` — leitura e gravação.
 *
 * POR QUE O PERFIL É HÍBRIDO, E NÃO SÓ ON-CHAIN
 *
 * Criar a conta de perfil custa rent (~0.0037 SOL, porque o programa reserva o
 * tamanho máximo das strings para a bio poder crescer depois). Isso é MAIS que
 * o claim de boas-vindas paga — e o perfil é justamente o que o app pede antes
 * de liberar as boas-vindas. Tornar a gravação on-chain obrigatória fecharia o
 * onboarding num impasse: sem perfil não há SOL, sem SOL não há perfil.
 *
 * Então: a escrita continua indo para o Pinata (grátis, funciona com carteira
 * zerada) e ancorar no contrato é uma ação explícita de quem já tem saldo. A
 * LEITURA prefere a chain quando existe conta lá — o que estiver on-chain é
 * mais forte, porque só o dono da carteira pôde ter escrito.
 *
 * Isso também preserva quem já tinha perfil antes da migração: nada precisa
 * ser reescrito para continuar aparecendo.
 */

import { Connection, Transaction, ComputeBudgetProgram } from '@solana/web3.js';
import {
  initProfileIx, updateProfileIx, profilePda, decodeProfile, parseProgramError,
} from './urbanProgram';
import { fetchAccount } from './rpc';
import { confirmSignature, clientRpcUrl } from '../solana/confirm';
import { AVATAR_PREFIX } from '../social/profile';

/**
 * Traduz a conta on-chain para o shape que a UI já usa.
 *
 * A diferença de formato que importa é o avatar: o app guarda a URL completa
 * do gateway, o programa guarda só o CID. Guardar a URL on-chain seria pagar
 * rent por 34 bytes de prefixo constante em toda conta de perfil — e amarraria
 * o gateway do Pinata dentro do contrato, que é a última coisa que deveria
 * depender de um provedor.
 */
export function toAppProfile(account) {
  if (!account) return null;

  const socials = {};
  for (const [k, v] of Object.entries(account.socials || {})) {
    if (v) socials[k] = v;
  }

  return {
    wallet: account.wallet,
    handle: account.handle || '',
    bio: account.bio || '',
    avatarUrl: account.avatarCid ? AVATAR_PREFIX + account.avatarCid : '',
    socials,
    createdAt: account.createdAt * 1000,
    updatedAt: account.updatedAt * 1000,
    onChain: true,
  };
}

/** Extrai o CID de uma URL do gateway. Fora do prefixo conhecido, string vazia
 *  — o mesmo critério que `normalizeProfile` aplica na escrita off-chain. */
export function avatarCidFromUrl(avatarUrl) {
  const url = typeof avatarUrl === 'string' ? avatarUrl.trim() : '';
  if (!url.startsWith(AVATAR_PREFIX)) return '';
  return url.slice(AVATAR_PREFIX.length).split(/[/?#]/)[0].slice(0, 64);
}

/**
 * Lê o perfil on-chain.
 * @returns {Promise<object|null>} `null` quando a carteira não ancorou perfil
 */
export async function readProfile(rpcUrl, wallet) {
  const account = await fetchAccount(rpcUrl, profilePda(wallet));
  if (!account) return null;
  return toAppProfile(decodeProfile(account.data));
}

/**
 * Grava o perfil no contrato. Cria a conta na primeira vez, atualiza depois.
 *
 * @param {object} wallet  objeto do useWallet()
 * @param {object} profile perfil já normalizado (shape do app)
 * @returns {Promise<{ signature: string, created: boolean }>}
 */
export async function sendSaveProfile(wallet, profile) {
  if (!wallet?.publicKey || !wallet?.sendTransaction) {
    throw new Error('Conecte sua carteira.');
  }

  const rpcUrl = clientRpcUrl();
  const owner = wallet.publicKey;

  // Decide entre criar e atualizar pela existência da conta: `init` numa conta
  // que já existe falha com "already in use", e `update` numa que não existe
  // falha na constraint de seeds. Nenhuma das duas mensagens diz ao usuário o
  // que fazer, então a escolha é feita aqui.
  const existing = await fetchAccount(rpcUrl, profilePda(owner));

  const args = {
    owner,
    handle: profile?.handle || '',
    bio: profile?.bio || '',
    avatarCid: avatarCidFromUrl(profile?.avatarUrl),
    socials: {
      instagram: profile?.socials?.instagram || '',
      x: profile?.socials?.x || '',
      tiktok: profile?.socials?.tiktok || '',
      farcaster: profile?.socials?.farcaster || '',
    },
  };

  const connection = new Connection(rpcUrl, {
    commitment: 'confirmed',
    disableRetryOnRateLimit: true,
  });

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');

  const tx = new Transaction({ feePayer: owner, blockhash, lastValidBlockHeight }).add(
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 200000 }),
    existing ? updateProfileIx(args) : initProfileIx(args)
  );

  let signature;
  try {
    signature = await wallet.sendTransaction(tx, connection, {
      skipPreflight: false,
      maxRetries: 5,
    });
  } catch (err) {
    throw new Error(parseProgramError(err) || 'Não foi possível salvar o perfil no contrato.');
  }

  const ok = await confirmSignature({ rpcUrl, signature });
  if (!ok) {
    const err = new Error('A rede demorou a confirmar. Recarregue em instantes para conferir.');
    err.signature = signature;
    err.pending = true;
    throw err;
  }

  return { signature, created: !existing };
}
