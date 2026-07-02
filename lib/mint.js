/**
 * lib/mint.js
 * Upload (imagem/JSON → /api/upload) e mint de NFT via UMI (proxy /api/rpc).
 * Reusado tanto pelo registro de uma obra original (pages/index.jsx) quanto
 * pelo mint de uma edição coletada (components/CollectButton.jsx).
 */

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

export async function uploadFile(file) {
  const base64 = await fileToBase64(file);
  const res = await fetch('/api/upload', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'image', data: base64, filename: file.name || 'arte.jpg', mime: file.type || 'image/jpeg' }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Upload imagem: ${json.error || res.status}`);
  return json.url;
}

export async function uploadJson(obj) {
  const res = await fetch('/api/upload', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'json', data: obj }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Upload dados: ${json.error || res.status}`);
  return json.url;
}

// O programa Metaplex Token Metadata rejeita (NameTooLongError) qualquer
// `name` on-chain acima de 32 bytes UTF-8 — nomes como "Urban Art — X —
// Edição Coletada" estouram isso fácil. Corta com segurança sem quebrar
// caracteres multi-byte (acentos, travessão). O nome completo continua
// intacto no metadata JSON off-chain, que é o que carteiras/exploradores
// preferem mostrar.
const MAX_ONCHAIN_NAME_BYTES = 32;
function truncateOnChainName(name) {
  const bytes = new TextEncoder().encode(name);
  if (bytes.length <= MAX_ONCHAIN_NAME_BYTES) return name;
  let cut = bytes.slice(0, MAX_ONCHAIN_NAME_BYTES);
  // Recua até achar um limite de caractere válido (evita cortar no meio de um byte multi-byte)
  while (cut.length > 0) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(cut); }
    catch { cut = cut.slice(0, -1); }
  }
  return '';
}

/**
 * Minta um NFT via UMI (Metaplex Token Metadata) usando o RPC proxy Helius.
 * O NFT vai pra carteira que assina (`wallet`) — ela paga o gás.
 *
 * Usa `builder.send()` (só envia) em vez de `sendAndConfirm()` porque o
 * `confirm()` da UMI só sabe esperar via WebSocket — e a Vercel não suporta
 * upgrade de WS em API routes, então essa espera nunca resolve por conta
 * própria. Confirmamos manualmente por polling HTTP (getSignatureStatuses),
 * igual ao padrão já usado em lib/likePayment.js e lib/collectPayment.js.
 */
export async function mintNft({ wallet, metadataUri, name }) {
  const { createUmi } = await import('@metaplex-foundation/umi-bundle-defaults');
  const { walletAdapterIdentity } = await import('@metaplex-foundation/umi-signer-wallet-adapters');
  const { mplTokenMetadata, createNft, fetchDigitalAsset } = await import('@metaplex-foundation/mpl-token-metadata');
  const { generateSigner, percentAmount, base58 } = await import('@metaplex-foundation/umi');
  const { setComputeUnitPrice } = await import('@metaplex-foundation/mpl-toolbox');

  const rpcUrl = `${window.location.origin}/api/rpc`;
  const umi = createUmi(rpcUrl).use(walletAdapterIdentity(wallet)).use(mplTokenMetadata());

  const mintSigner = generateSigner(umi);
  const ownerPublicKey = umi.identity.publicKey;

  let builder = createNft(umi, {
    mint: mintSigner, name: truncateOnChainName(name), symbol: 'URBAN', uri: metadataUri,
    sellerFeeBasisPoints: percentAmount(5), isMutable: true,
    tokenOwner: ownerPublicKey,
  });

  // Taxa de prioridade — acelera inclusão no bloco
  try { builder = builder.prepend(setComputeUnitPrice(umi, { microLamports: 200000 })); } catch {}

  // Verifica se o NFT já existe on-chain (fallback caso o polling de
  // assinatura não encontre nada — o mint pode ter confirmado mesmo assim)
  async function nftExiste() {
    try { await fetchDigitalAsset(umi, mintSigner.publicKey); return true; }
    catch { return false; }
  }

  const signatureBytes = await builder.send(umi, { skipPreflight: true, maxRetries: 5 });
  const signature = base58.deserialize(signatureBytes)[0];

  // Polling HTTP direto (getSignatureStatuses) — rápido e não depende de WS
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
      if (status.err) throw new Error('Transação de mint falhou ao confirmar.');
      if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') {
        return mintSigner.publicKey.toString();
      }
    }
    await new Promise(r => setTimeout(r, 1500));
  }

  // Não confirmou via assinatura em ~30s — checa se o asset já existe (DAS)
  if (await nftExiste()) return mintSigner.publicKey.toString();
  throw new Error('Não foi possível confirmar o mint. Tente novamente.');
}
