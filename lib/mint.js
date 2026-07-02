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

/**
 * Minta um NFT via UMI (Metaplex Token Metadata) usando o RPC proxy Helius.
 * O NFT vai pra carteira que assina (`wallet`) — ela paga o gás.
 */
export async function mintNft({ wallet, metadataUri, name }) {
  const { createUmi } = await import('@metaplex-foundation/umi-bundle-defaults');
  const { walletAdapterIdentity } = await import('@metaplex-foundation/umi-signer-wallet-adapters');
  const { mplTokenMetadata, createNft, fetchDigitalAsset } = await import('@metaplex-foundation/mpl-token-metadata');
  const { generateSigner, percentAmount } = await import('@metaplex-foundation/umi');
  const { setComputeUnitPrice } = await import('@metaplex-foundation/mpl-toolbox');

  const rpcUrl = `${window.location.origin}/api/rpc`;
  const umi = createUmi(rpcUrl).use(walletAdapterIdentity(wallet)).use(mplTokenMetadata());

  const mintSigner = generateSigner(umi);
  const ownerPublicKey = umi.identity.publicKey;

  let builder = createNft(umi, {
    mint: mintSigner, name, symbol: 'URBAN', uri: metadataUri,
    sellerFeeBasisPoints: percentAmount(5), isMutable: true,
    tokenOwner: ownerPublicKey,
  });

  // Taxa de prioridade — acelera inclusão no bloco
  try { builder = builder.prepend(setComputeUnitPrice(umi, { microLamports: 200000 })); } catch {}

  // Verifica se o NFT já existe on-chain (polling até 20s)
  async function nftExiste() {
    try { await fetchDigitalAsset(umi, mintSigner.publicKey); return true; }
    catch { return false; }
  }
  async function aguardarConfirmacao(tentativas = 10) {
    for (let i = 0; i < tentativas; i++) {
      await new Promise(r => setTimeout(r, 2000)); // 2s entre checagens
      if (await nftExiste()) return true;
    }
    return false;
  }

  // Envia a transação. Se a confirmação automática falhar por timeout,
  // fazemos polling manual — porque o NFT frequentemente confirma depois.
  try {
    await builder.sendAndConfirm(umi, {
      confirm: { commitment: 'confirmed' },
      send:    { skipPreflight: true, maxRetries: 5, commitment: 'confirmed' },
    });
    // Sucesso direto
    return mintSigner.publicKey.toString();
  } catch (err) {
    const msg = String(err?.message || '');
    // Erros que NÃO são timeout → falha real, repassa
    if (msg.includes('insufficient') || msg.includes('rejected') || msg.includes('0x1')) {
      throw err;
    }
    // Timeout / blockhash expirado → verifica de verdade se foi mintado
    const ok = await aguardarConfirmacao(10); // até ~20s
    if (ok) return mintSigner.publicKey.toString();
    throw new Error('Não foi possível confirmar o mint. Tente novamente.');
  }
}
