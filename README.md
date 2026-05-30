# 🌍 Urban Secure — Arte Urbana na Blockchain Solana

Mini app mobile para registrar arte urbana como NFT na rede Solana,
com GPS de alta precisão e integração com Phantom e Solflare.

---

## 🛠️ Tecnologias

| Camada | Tecnologia |
|--------|-----------|
| Frontend | Next.js 14 + React |
| Blockchain | Solana (devnet / mainnet-beta) |
| NFT | Metaplex Token Metadata + Bundlr/Arweave |
| Wallets | Phantom, Solflare |
| Mapa | Leaflet + OpenStreetMap |
| Deploy | Vercel |

---

## 📱 Wallets Suportadas

| Wallet | Suporte Solana | Link |
|--------|---------------|------|
| **Phantom** | ✅ Nativo | [phantom.app](https://phantom.app) |
| **Solflare** | ✅ Nativo | [solflare.com](https://solflare.com) |
| **MetaMask** | ⚠️ Via Snap | [Instalar Solana Snap](https://snaps.metamask.io/snap/npm/solflare-wallet/solana-snap/) |

> **MetaMask** é uma carteira Ethereum e não suporta Solana nativamente.
> Para usar com este app, instale o **Solana Snap** no link acima.

---

## 🚀 Passo a passo: GitHub → Vercel

### 1. Pré-requisitos

Instale no seu computador:
- [Git](https://git-scm.com/downloads)
- [Node.js 18+](https://nodejs.org)
- Conta no [GitHub](https://github.com)
- Conta no [Vercel](https://vercel.com) (gratuita, faça login com o GitHub)

---

### 2. Configurar o projeto localmente

```bash
# Entre na pasta do projeto
cd urban-secure

# Copie o arquivo de variáveis de ambiente
cp .env.example .env.local

# Instale as dependências
npm install

# Teste localmente
npm run dev
```

Abra `http://localhost:3000` no navegador.

---

### 3. Criar repositório no GitHub

**Opção A — Via site (mais fácil):**

1. Acesse [github.com/new](https://github.com/new)
2. Nome: `urban-secure`
3. Deixe **Privado** ou **Público** (sua escolha)
4. **NÃO** marque "Initialize this repository"
5. Clique em **Create repository**

**Opção B — Via GitHub CLI:**
```bash
gh repo create urban-secure --public
```

---

### 4. Enviar o código para o GitHub

No terminal, dentro da pasta `urban-secure`:

```bash
# Inicializa o Git (se ainda não iniciou)
git init

# Adiciona todos os arquivos
git add .

# Primeiro commit
git commit -m "feat: urban secure mini app - solana nft"

# Aponta para o repositório que você criou
git remote add origin https://github.com/SEU_USUARIO/urban-secure.git

# Envia o código
git push -u origin main
```

> Substitua `SEU_USUARIO` pelo seu nome de usuário do GitHub.

---

### 5. Deploy no Vercel

**Opção A — Via site (recomendado):**

1. Acesse [vercel.com/new](https://vercel.com/new)
2. Clique em **"Import Git Repository"**
3. Selecione o repositório `urban-secure`
4. Em **"Environment Variables"**, adicione:
   ```
   NEXT_PUBLIC_SOLANA_NETWORK = devnet
   ```
5. Clique em **Deploy**
6. Aguarde ~2 minutos — o Vercel vai compilar e publicar

**Opção B — Via CLI:**
```bash
# Instala o Vercel CLI
npm install -g vercel

# Faz o deploy
vercel

# Siga as instruções interativas
# Quando perguntar sobre variáveis de ambiente, adicione:
# NEXT_PUBLIC_SOLANA_NETWORK = devnet
```

---

### 6. Testar o app

1. Abra a URL gerada pelo Vercel (ex: `https://urban-secure-xxxxx.vercel.app`)
2. Instale a carteira **Phantom** no celular: [phantom.app](https://phantom.app)
3. Crie uma carteira e obtenha **SOL de devnet** (gratuito):
   - Acesse [faucet.solana.com](https://faucet.solana.com)
   - Cole o endereço da sua carteira Phantom
   - Clique em "Airdrop 2 SOL"
4. Abra o app, conecte a carteira, aguarde o GPS calibrar
5. Preencha os dados e clique em **"Mintar na Solana"**
6. Confirme a transação na carteira
7. Veja o NFT no [Solana Explorer](https://explorer.solana.com/?cluster=devnet)

---

### 7. Ir para Mainnet (produção)

Quando quiser usar com SOL real:

1. No painel do Vercel, vá em **Settings → Environment Variables**
2. Altere:
   ```
   NEXT_PUBLIC_SOLANA_NETWORK = mainnet-beta
   ```
3. Clique em **Redeploy**

> ⚠️ Na mainnet, o upload para Arweave via Bundlr cobra uma pequena taxa em SOL (~0.01 SOL por NFT).

---

## 📁 Estrutura do projeto

```
urban-secure/
├── pages/
│   ├── _app.jsx          # Providers de wallet Solana
│   └── index.jsx         # Página principal (mapa + mint)
├── components/
│   └── MapView.jsx       # Mapa Leaflet com GPS de alta precisão
├── styles/
│   └── globals.css       # Tema escuro mobile-first
├── public/
│   └── manifest.json     # PWA manifest
├── .env.example          # Variáveis de ambiente
├── next.config.mjs       # Config Next.js + polyfills Solana
└── vercel.json           # Config Vercel
```

---

## 🐛 Problemas comuns

| Problema | Solução |
|----------|---------|
| `WalletNotConnectedError` | Conecte a carteira antes de mintar |
| `Insufficient funds` | Adicione SOL via faucet (devnet) |
| GPS não calibra | Fique ao ar livre e aguarde 10-30s |
| Build falha no Vercel | Verifique os polyfills em `next.config.mjs` |
| MetaMask não aparece | Instale o Solana Snap |

---

## 📄 Licença

MIT
