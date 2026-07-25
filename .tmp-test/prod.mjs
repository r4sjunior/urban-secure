import nacl from 'tweetnacl';
import { Keypair } from '@solana/web3.js';
import { buildWelcomeMessage } from './lib/social/welcomeSignature.js';
import { buildProfileMessage, hashProfileContent } from './lib/social/profileSignature.js';
import { normalizeProfile } from './lib/social/profile.js';

const BASE = 'https://urban-secure.vercel.app';
const kp = Keypair.generate();
const wallet = kp.publicKey.toBase58();
const assinar = (m) => Buffer.from(nacl.sign.detached(new TextEncoder().encode(m), kp.secretKey)).toString('base64');

const post = async (rota, corpo) => {
  const r = await fetch(BASE + rota, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  return { code: r.status, j: await r.json().catch(() => ({})) };
};

console.log('carteira de teste:', wallet.slice(0, 12) + '...\n');

// GET do claim — é o que a tela chama ao abrir
const g = await fetch(`${BASE}/api/claim?wallet=${wallet}`);
const gj = await g.json();
console.log('GET /api/claim →', g.status, g.ok ? `canClaim=${gj.status.canClaim}, valor=${gj.status.amountSol} SOL` : gj.error);

// Boas-vindas sem perfil
const t1 = Date.now();
const w1 = await post('/api/welcome', { wallet, timestamp: t1, signature: assinar(buildWelcomeMessage({ wallet, timestamp: t1 })) });
console.log('\nboas-vindas sem perfil →', w1.code);
console.log('  "' + (w1.j.error || '') + '"');

// Preenche perfil
const norm = normalizeProfile({ handle: 'TesteProd', bio: 'Validando o app em producao.', socials: {}, avatarUrl: '' }, wallet);
const t2 = Date.now();
const pf = await post('/api/profile', { ...norm, timestamp: t2,
  signature: assinar(buildProfileMessage({ wallet, contentHash: hashProfileContent(norm), timestamp: t2 })) });
console.log('\nsalvar perfil →', pf.code);

// Boas-vindas agora
const t3 = Date.now();
const w2 = await post('/api/welcome', { wallet, timestamp: t3, signature: assinar(buildWelcomeMessage({ wallet, timestamp: t3 })) });
console.log('\nreceber boas-vindas →', w2.code);
if (w2.j.ok) {
  console.log('  recebeu', w2.j.amountSol, 'SOL');
  console.log('  tx: https://explorer.solana.com/tx/' + w2.j.signature + '?cluster=devnet');
} else {
  console.log('  "' + (w2.j.error || '') + '"');
}
