import nacl from 'tweetnacl';
import { Keypair } from '@solana/web3.js';
import { buildClaimMessage, claimDay } from './lib/social/claimSignature.js';

const BASE = 'http://localhost:3000';
const kp = Keypair.generate();
const wallet = kp.publicKey.toBase58();

const saldo = async (w) => {
  const r = await fetch('https://api.devnet.solana.com', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [w, { commitment: 'confirmed' }] }),
  });
  return ((await r.json())?.result?.value ?? 0) / 1e9;
};

const TREASURY = '5arzYD6ie4rs9hqk3ffiNWjZoxdBB3N393KYYQNVsi9m';
console.log('carteira do teste:', wallet);
console.log('saldo dela antes :', await saldo(wallet), 'SOL');
console.log('treasury antes   :', await saldo(TREASURY), 'SOL');

const ts = Date.now();
const msg = buildClaimMessage({ wallet, day: claimDay(ts), timestamp: ts });
const signature = Buffer.from(nacl.sign.detached(new TextEncoder().encode(msg), kp.secretKey)).toString('base64');

console.log('\nexecutando o claim...');
const r = await fetch(`${BASE}/api/claim`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.88.0.1' },
  body: JSON.stringify({ wallet, timestamp: ts, signature }),
});
const j = await r.json();
console.log('HTTP', r.status);
console.log(JSON.stringify(j, null, 2).slice(0, 500));

if (j.ok) {
  await new Promise(r => setTimeout(r, 3000));
  console.log('\nsaldo dela depois:', await saldo(wallet), 'SOL');
  console.log('treasury depois  :', await saldo(TREASURY), 'SOL');
  console.log('explorer: https://explorer.solana.com/tx/' + j.signature + '?cluster=devnet');
}
