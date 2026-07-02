/**
 * lib/vaultSigner.js
 * Vault custodial do marketplace de revenda: uma keypair do servidor guarda
 * o NFT enquanto ele está anunciado pra venda (transferido pelo vendedor no
 * momento do anúncio) e libera pro comprador assim que o pagamento é
 * confirmado on-chain — ou devolve ao vendedor se ele cancelar o anúncio.
 *
 * SERVIDOR APENAS — nunca importar isto de um componente client-side.
 * Requer a env var MARKETPLACE_VAULT_SECRET_KEY (keypair Solana em base58,
 * 64 bytes — o mesmo formato exportado por `solana-keygen` ou pelo Phantom).
 */
import nacl from 'tweetnacl';
import bs58 from 'bs58';

function getSecretKeyBytes() {
  const raw = process.env.MARKETPLACE_VAULT_SECRET_KEY;
  if (!raw) throw new Error('MARKETPLACE_VAULT_SECRET_KEY ausente no ambiente da função.');
  const bytes = bs58.decode(raw.trim());
  if (bytes.length !== 64) throw new Error('MARKETPLACE_VAULT_SECRET_KEY inválida (esperado keypair de 64 bytes em base58).');
  return bytes;
}

function heliusRpcUrl() {
  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) throw new Error('HELIUS_API_KEY ausente no ambiente da função.');
  const network = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet';
  const cluster = network === 'mainnet-beta' ? 'mainnet' : 'devnet';
  return `https://${cluster}.helius-rpc.com/?api-key=${apiKey}`;
}

export function getVaultAddress() {
  const { publicKey } = nacl.sign.keyPair.fromSecretKey(getSecretKeyBytes());
  return bs58.encode(publicKey);
}

/**
 * Confirma, via RPC padrão (não DAS — funciona em devnet e mainnet), que a
 * vault já recebeu o NFT antes de aceitar o anúncio.
 */
export async function verifyVaultHoldsMint(mint) {
  const vaultAddress = getVaultAddress();
  const r = await fetch(heliusRpcUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getTokenAccountsByOwner',
      params: [vaultAddress, { mint }, { encoding: 'jsonParsed' }],
    }),
  });
  const json = await r.json();
  const accounts = json?.result?.value || [];
  return accounts.some(a => {
    const amt = a?.account?.data?.parsed?.info?.tokenAmount;
    return amt && Number(amt.amount) >= 1;
  });
}

/**
 * Transfere um NFT URBAN da vault para `toWallet`, assinado pela keypair do
 * servidor. Usado depois de confirmar uma compra, ou pra devolver a obra
 * quando o vendedor cancela o anúncio.
 */
export async function transferFromVault({ mint, toWallet }) {
  const { createUmi } = await import('@metaplex-foundation/umi-bundle-defaults');
  const { mplTokenMetadata, transferV1, fetchDigitalAsset, TokenStandard } = await import('@metaplex-foundation/mpl-token-metadata');
  const { publicKey: toUmiPublicKey, createSignerFromKeypair, keypairIdentity, base58 } = await import('@metaplex-foundation/umi');
  const { setComputeUnitPrice } = await import('@metaplex-foundation/mpl-toolbox');

  const rpcUrl = heliusRpcUrl();
  const umi = createUmi(rpcUrl).use(mplTokenMetadata());
  const keypair = umi.eddsa.createKeypairFromSecretKey(getSecretKeyBytes());
  const signer = createSignerFromKeypair(umi, keypair);
  umi.use(keypairIdentity(signer));

  const mintPk = toUmiPublicKey(mint);
  const destPk = toUmiPublicKey(toWallet);

  const asset = await fetchDigitalAsset(umi, mintPk);
  let ts = TokenStandard.NonFungible;
  const onChainTs = asset?.metadata?.tokenStandard;
  if (onChainTs && onChainTs.__option === 'Some') ts = onChainTs.value;

  let builder = transferV1(umi, {
    mint: mintPk,
    authority: umi.identity,
    tokenOwner: umi.identity.publicKey,
    destinationOwner: destPk,
    tokenStandard: ts,
  });
  try { builder = builder.prepend(setComputeUnitPrice(umi, { microLamports: 200000 })); } catch {}

  // send() + polling manual em vez de sendAndConfirm() — evita depender de
  // WebSocket (indisponível/instável em ambiente serverless), mesmo padrão
  // usado em lib/mint.js e lib/nftTransfer.js.
  const signatureBytes = await builder.send(umi, { skipPreflight: true, maxRetries: 5 });
  const signature = base58.deserialize(signatureBytes)[0];

  for (let i = 0; i < 20; i++) {
    let status;
    try {
      const r = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'getSignatureStatuses',
          params: [[signature], { searchTransactionHistory: true }],
        }),
      });
      const json = await r.json();
      status = json?.result?.value?.[0];
    } catch { /* tenta de novo na próxima volta */ }

    if (status) {
      if (status.err) throw new Error('Transação de transferência da vault falhou ao confirmar.');
      if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') {
        return;
      }
    }
    await new Promise(r => setTimeout(r, 1500));
  }

  const stillInVault = await verifyVaultHoldsMint(mint);
  if (!stillInVault) return;
  throw new Error('Não foi possível confirmar a transferência da vault.');
}
