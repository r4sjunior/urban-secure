# 🌍 Urban Secure v2

Mini app mobile para registrar arte urbana como NFT na Solana.

## Stack
Next.js 15 · Solana · Metaplex UMI · Helius RPC · Pinata IPFS · Leaflet

## Variáveis de ambiente (Vercel)
```
NEXT_PUBLIC_SOLANA_NETWORK = devnet
HELIUS_API_KEY = sua_key        (servidor)
PINATA_JWT = seu_jwt            (servidor)
```

## Rodar local
```
npm install
cp .env.example .env.local   # preencha as chaves
npm run dev
```

## Deploy
Push no GitHub → Vercel faz deploy automático.
