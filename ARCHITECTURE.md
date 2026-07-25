# Urban Secure Social — Arquitetura

Documento de referência da transformação do Urban Secure (registro de arte
urbana como NFT) em uma **rede social vertical de arte urbana** na Solana devnet.

---

## 0. O que já existe (e o que aproveitamos)

O repo atual é uma SPA Next.js 15 (Pages Router) com ~5.400 linhas. As peças
que **continuam de pé sem mudança**:

| Peça | Arquivo | Papel no app novo |
|---|---|---|
| Proxy RPC com allowlist | `pages/api/rpc.js` | Continua sendo o único caminho pra chain |
| Proxy de upload IPFS | `pages/api/upload.js` | Avatares e imagens de figurinha passam por aqui |
| Store com concorrência otimista | `lib/pinataStore.js` | Base de **toda** persistência off-chain nova |
| Auth por assinatura ed25519 | `context/WalletAuthContext.jsx` | Vira a base do login de perfil |
| Signer custodial server-side | `lib/vaultSigner.js` | Padrão copiado por `lib/treasury.js` |
| Mapa Leaflet | `components/MapView.jsx` | Continua o elemento central |
| Mint via UMI | `lib/mint.js` | Reusado pelo mint de figurinha |

O padrão arquitetural do projeto já é bem definido e **não vamos brigar com ele**:

> Efeito de valor acontece on-chain (transferência de SOL, mint de NFT).
> Estado de coordenação vive num pin JSON no Pinata, protegido por
> `mutatePin` (read-modify-write com detecção de conflito).
> Autoria é provada por assinatura ed25519 da carteira, verificada no servidor.

Tudo que é novo segue exatamente esse padrão.

### Decisões que NÃO vamos tomar

**Não migrar para App Router.** O app é uma SPA de mapa: estado global de
carteira, Leaflet client-only, `next/dynamic` com `ssr:false` em quase tudo.
Server Components não têm o que fazer aqui. A migração custaria dias e
quebraria o wallet-adapter, em troca de zero ganho de produto. Pages Router
fica.

**Não trocar Pinata por um banco de verdade agora.** É tentador (Neon,
Upstash), mas `mutatePin` já resolve concorrência, o JWT já está configurado,
e trocar o storage no meio de uma reescrita de produto é dobrar o risco.
Quando o volume justificar, a troca é localizada: só `lib/pinataStore.js`
muda, porque todo o resto já fala através dele.

---

## 1. Estrutura de pastas

O `lib/` atual é flat com 18 arquivos. Com as features novas vai a ~35, o que
deixa de ser navegável. A reorganização é **por domínio**, não por tipo:

```
urban-secure/
├── ARCHITECTURE.md                 ← este documento
│
├── lib/
│   ├── config.js                   ✅ CRIADO — números do jogo (claim, prêmio, raridade)
│   ├── collections.js              ✅ CRIADO — nomes das "tabelas" no Pinata
│   ├── treasury.js                 ✅ CRIADO — carteira do projeto (server-only)
│   ├── pinataStore.js              (mantido)
│   ├── mint.js  resizeImage.js  sanitize.js  safeJson.js  timeAgo.js  sound.js
│   │
│   ├── social/                     ← NOVO domínio: perfil, claim, ranking
│   │   ├── profile.js              leitura/escrita de perfil + validação
│   │   ├── profileSignature.js     mensagem canônica assinada ao editar perfil
│   │   ├── claim.js                regra de streak (pura, testável, sem I/O)
│   │   ├── claimSignature.js       mensagem canônica do claim
│   │   └── weekly.js               janela da semana ISO + apuração do ranking
│   │
│   ├── stickers/                   ← NOVO domínio: figurinhas
│   │   ├── mintSticker.js          mint da figurinha pela treasury
│   │   ├── album.js                monta o álbum (slots, buracos, progresso)
│   │   ├── rarity.js               sorteio + estilo visual por raridade
│   │   └── tradeSignature.js       mensagem canônica da proposta de troca
│   │
│   ├── capture/                    ← NOVO domínio: câmera
│   │   ├── useCamera.js            hook getUserMedia (foto + vídeo mudo)
│   │   └── captureProof.js         marca a mídia como capturada ao vivo
│   │
│   ├── market/                     ← mercado existente, só agrupado
│   │   ├── collectPayment.js  likePayment.js  listingPayment.js
│   │   ├── nftTransfer.js  vaultSigner.js
│   │   └── *Signature.js
│   │
│   └── hooks/
│       ├── useMyNfts.js            (movido)
│       ├── useProfile.js           NOVO
│       ├── useClaim.js             NOVO
│       └── useAlbum.js             NOVO
│
├── context/
│   ├── ArtsContext.jsx             (mantido)
│   ├── WalletAuthContext.jsx       (mantido)
│   ├── ProfileContext.jsx          NOVO — perfil do usuário logado
│   └── ClaimContext.jsx            NOVO — estado de claim/streak global
│
├── components/
│   ├── map/                        MapView, ArtPopup            (agrupado)
│   ├── feed/                       ArtFeed, LikeButton, CommentsSection, Leaderboard
│   ├── market/                     MarketModal, CollectButton, TransferModal
│   ├── shell/                      BootScreen, SoundToggle, AudiusPlayer, WalletHandler, ClientOnly
│   │
│   ├── profile/                    ← NOVO
│   │   ├── ProfileSheet.jsx        perfil próprio (edição)
│   │   ├── ProfileCard.jsx         perfil de terceiro (visualização)
│   │   ├── AvatarUpload.jsx        upload + crop + IPFS
│   │   ├── SocialLinks.jsx         handles das redes
│   │   └── StatsGrid.jsx           artes / figurinhas / streak / ranking
│   │
│   ├── claim/                      ← NOVO
│   │   ├── ClaimButton.jsx         CTA principal, com cooldown ao vivo
│   │   ├── StreakTracker.jsx       trilha de 7 dias
│   │   └── ClaimResultModal.jsx    confirmação + link do explorer
│   │
│   ├── stickers/                   ← NOVO
│   │   ├── PackOpening.jsx         orquestra a abertura (estado + som)
│   │   ├── Pack3D.jsx              cena React Three Fiber (§5)
│   │   ├── StickerCard.jsx         figurinha 2D com borda por raridade
│   │   ├── AlbumGrid.jsx           álbum com slots vazios
│   │   └── TradeModal.jsx          propor / aceitar troca
│   │
│   └── capture/                    ← NOVO
│       ├── CameraCapture.jsx       viewfinder ao vivo (foto + vídeo)
│       └── CaptureReview.jsx       revisar / refazer antes do mint
│
├── pages/
│   ├── index.jsx                   mapa (permanece a home)
│   ├── perfil/[wallet].jsx         NOVO — perfil público
│   ├── album.jsx                   NOVO — álbum de figurinhas
│   ├── ranking.jsx                 NOVO — ranking semanal
│   │
│   └── api/
│       ├── rpc.js  upload.js  arts.js  registry.js       (mantidos)
│       ├── likes.js  comments.js  collects.js  listings.js  offers.js  vault.js
│       ├── profile.js              NOVO — GET/POST perfil
│       ├── claim.js                NOVO — executa o claim diário
│       ├── stickers.js             NOVO — GET álbum, POST abrir pacote
│       ├── trades.js               NOVO — propor/aceitar/recusar troca
│       ├── ranking.js              NOVO — ranking da semana corrente
│       └── cron/
│           └── weekly-payout.js    NOVO — premiação (Vercel Cron, segundas)
│
└── types/
    ├── art.ts                      (mantido)
    └── social.ts                   ✅ CRIADO — Profile, ClaimState, Sticker, Trade…
```

---

## 2. Camada on-chain: Anchor ou Metaplex + PDA?

### A pergunta real

Você pediu "o máximo possível on-chain". A resposta honesta é que **PDA sem
programa próprio não existe**: PDAs são contas de um programa específico. Sem
escrever um programa, as únicas coisas que dá pra colocar on-chain são
transferências de SOL, NFTs Metaplex e memos. Não dá pra ter um contador de
streak on-chain sem código on-chain.

Então a escolha é binária: **escrever um programa Anchor, ou não**.

### Recomendação: duas fases

**Fase 1 — sem Rust (é onde começamos).**
Todo *efeito de valor* já é on-chain e verificável por qualquer pessoa:

- claim = transferência real de SOL da treasury → usuário, com memo `"claim d3"`
- figurinha = NFT real mintado na carteira do usuário
- prêmio = transferência real, com memo `"premio 2026-W31 #1"`
- troca = duas transferências reais de NFT

O que fica off-chain é só o **estado de controle**: o contador de streak e o
timestamp do último claim. Um atacante que comprometesse nosso servidor
poderia forjar streak — mas não poderia criar SOL nem NFT do nada, e todo
pagamento indevido ficaria gravado na chain, auditável.

**Por que começar assim:** Anchor no Windows exige WSL2 + Rust + Solana CLI +
Anchor CLI, e cada iteração de programa é build + deploy + teste. Colocar isso
no caminho crítico antes de você ter visto o produto de pé é como o projeto
morre. A Fase 1 entrega o produto inteiro funcionando.

**Fase 2 — programa `urban_social`.**
Migra o estado de controle pra PDAs. Como os tipos em `types/social.ts` já
foram modelados como contas (chave derivável, sem array de tamanho livre), a
migração é trocar a camada de acesso, não reescrever o app.

### O programa da Fase 2, quando chegarmos

```rust
// programs/urban_social/src/lib.rs
#[program]
pub mod urban_social {
    // Perfil — PDA ["profile", wallet]
    pub fn init_profile(ctx: Context<InitProfile>, handle: String, bio: String) -> Result<()>
    pub fn update_profile(ctx: Context<UpdateProfile>, ...) -> Result<()>

    // Claim — PDA ["claim", wallet]. A trava de 20h e o incremento de streak
    // passam a ser validados pelo runtime da Solana com Clock::get(), o que
    // torna forjar streak impossível, não só difícil.
    pub fn claim_daily(ctx: Context<ClaimDaily>) -> Result<()>

    // Vault do faucet — PDA ["treasury"]. O SOL passa a viver numa conta do
    // programa: nem nós conseguimos sacar fora das regras do código.
    pub fn fund_treasury(ctx: Context<FundTreasury>, lamports: u64) -> Result<()>
    pub fn pay_weekly_prize(ctx: Context<PayPrize>, week: u32, pos: u8) -> Result<()>

    // Troca — PDA ["trade", from, to, nonce]. Escrow atômico: as duas
    // figurinhas trocam de dono na mesma transação ou nenhuma troca.
    pub fn propose_trade(ctx: Context<ProposeTrade>, nonce: u64) -> Result<()>
    pub fn accept_trade(ctx: Context<AcceptTrade>) -> Result<()>
}
```

**Contas (PDAs):**

| PDA | Seeds | Tamanho | Guarda |
|---|---|---|---|
| `Profile` | `["profile", wallet]` | ~280 B | handle, bio, avatar CID, socials |
| `ClaimState` | `["claim", wallet]` | ~80 B | last_claim_ts, streak, cycles |
| `Treasury` | `["treasury"]` | ~48 B | SOL do faucet + autoridade |
| `WeekStats` | `["week", wallet, week_id]` | ~24 B | artes registradas na semana |
| `TradeEscrow` | `["trade", from, to, nonce]` | ~120 B | figurinhas em custódia |

Figurinhas **não** ganham PDA: são NFTs Metaplex, e a posse já é on-chain por
definição. Criar uma conta espelho seria estado duplicado que sai de sincronia.

### Padrão de NFT: migrar para Metaplex Core — **DECIDIDO ✅**

Decisão tomada em 2026-07-24: migrar. Impacto direto no bolso do faucet:

| | Token Metadata (hoje) | **Core** (recomendado) |
|---|---|---|
| Contas por NFT | 4 (mint, ATA, metadata, edition) | 1 |
| Rent por mint | ~0.0115 SOL | **~0.0029 SOL** |
| Claim diário (3 artes) | 0.0345 SOL | **0.0087 SOL** |

**Um claim diário fica ~4x mais barato.** Com 100 usuários ativos: 24 SOL/semana
vs 6 SOL/semana. Em devnet o SOL é grátis, mas a diferença decide se o app
sobrevive a uma eventual mainnet.

Efeito colateral que importa no teto do faucet: com `DAILY_TREASURY_BUDGET_SOL`
em 2 SOL, Token Metadata comporta **58 claims/dia**; Core comporta **230**.

**O que a migração envolve** (pendente — ver ordem abaixo):
1. `npm i @metaplex-foundation/mpl-core` e trocar `createNft` por `create` em
   `lib/mint.js`
2. Baixar `ART_MINT_COST_SOL` para `0.0029` em `lib/config.js`
3. Ajustar a leitura em `/api/arts.js` — Core aparece no DAS com
   `interface: "MplCoreAsset"`, não como `nonFungible`
4. Manter a leitura antiga em paralelo: as artes já mintadas continuam sendo
   Token Metadata e precisam seguir aparecendo no mapa. A migração é do mint
   novo, não do acervo.

---

## 3. Fluxo completo: claim → streak → figurinha

### 3.1 Claim diário

```
[cliente]                          [/api/claim]                    [chain]
   │
   ├─ 1. GET /api/claim?wallet=… ──────►
   │                                 lê ClaimState do Pinata
   │  ◄── { podeClaimar, proximoEm, streakAtual, valorSol } ──
   │
   ├─ 2. usuário toca "Resgatar"
   │
   ├─ 3. assina mensagem canônica (grátis, sem transação):
   │       "Urban Secure — Claim diario
   │        Carteira: <pubkey>
   │        Dia: 2026-07-24
   │        Nonce: <uuid>"
   │
   ├─ 4. POST /api/claim { wallet, signature, timestamp } ──►
   │                                 ┌─────────────────────────────────┐
   │                                 │ a. verifica assinatura ed25519  │
   │                                 │ b. timestamp dentro de 10 min   │
   │                                 │ c. rate limit por IP            │
   │                                 │ d. teto diário da treasury      │
   │                                 │ e. saldo > reserva              │
   │                                 │ f. 1ª vez? exige ≥1 arte        │
   │                                 │ g. cooldown de 20h passou?      │
   │                                 └─────────────────────────────────┘
   │                                          │
   │                                          ├── transfere SOL ────────►
   │                                          │   (memo: "claim d3")
   │                                          │   ◄── assinatura confirmada
   │                                          │
   │                                 grava ClaimState via mutatePin
   │                                 (streak+1, lastSignature)
   │                                          │
   │                                 streak % 7 == 0? ──► minta figurinha
   │                                          │
   │  ◄── { ok, sol, streak, signature, pacoteDisponivel } ──
```

**A ordem das travas importa** — vão do mais barato pro mais caro (rate limit
em memória → assinatura em CPU → leituras → RPC → escrita → transferência).
Recusar cedo é o que mantém um ataque em volume barato **pra nós**: um script
em loop nunca chega ao RPC nem à escrita.

**Reserva antes de transferir.** A transferência de SOL não é reversível e o
servidor pode morrer entre transferir e gravar. Se gravássemos só depois, uma
queda nesse intervalo deixaria o cooldown aberto e o retry pagaria de novo.
Reservando antes (`reserveClaim`, com `pending: true`), uma queda deixa o
cooldown **fechado**: no pior caso o usuário perde um claim, que é o lado
certo do erro. Falha na transferência dispara rollback do estado e do ledger.

### 3.2 Streak

```
Dia:    1    2    3    4    5    6    7      ← ciclo fecha
        ●────●────●────●────●────●────★
       1x   1x   1x   1x   1x   1x   2x      ← valor do claim
                                     │
                                     └─► 🎁 pacote de figurinha
                                     └─► completedCycles += 1
                                     └─► troca de figurinha liberada
```

- Cooldown de **20h** (não 24h): claimar às 9h hoje libera às 5h de amanhã.
  Com 24h cravadas o horário anda alguns minutos por dia e em uma semana
  quebra o streak de quem não fez nada de errado.
- Perde o streak após **48h** sem claimar — dá direito a pular um dia.
- O contador **não volta a zero** ao fechar um ciclo: cresce indefinidamente
  (7, 14, 21…) e cada múltiplo de 7 rende um pacote e paga dobrado.
  Resetar tornaria `longestStreak` inútil — travado em 7 pra sempre — e
  apagaria a conquista de quem mantém 30 dias seguidos, que é exatamente o
  comportamento que o app quer premiar. `completedCycles` sobe a cada ciclo
  fechado e **nunca** zera, porque é ele que libera a troca de figurinhas.

Regra implementada em `lib/social/claim.js` como **função pura** — recebe o
estado e o instante, devolve o próximo estado. Sem I/O, então dá pra testar
todos os casos de borda (virada de dia, fuso, ciclo, expiração) sem tocar em
rede.

### 3.3 Figurinha

```
1. Ciclo fechado → servidor sorteia:
     • raridade (comum 60% / raro 25% / épico 12% / lendário 3%)
     • uma arte do registry — ponderada pra favorecer artes com poucas
       figurinhas em circulação, senão as 3 primeiras artes do app viram
       90% de todas as figurinhas do mundo

2. Monta a imagem da figurinha (arte + moldura da raridade + crédito do
   artista) e sobe pro IPFS

3. Treasury minta o NFT direto na carteira do usuário — o usuário não
   paga nada e não assina nada

4. Cliente recebe { mint, rarity, art, artistName } e roda a animação 3D

5. Usuário "cola" no álbum → append-only, sem descolar (§ types/social.ts)
```

O **crédito ao artista original** é obrigatório e vai em três lugares: no
atributo on-chain do NFT, na imagem renderizada e na UI do álbum. É o que
mantém o incentivo de registrar arte: sua obra circula com seu nome.

### 3.4 Ranking semanal

- Semana: **segunda 00:00 → domingo 23:59**, fuso `America/Sao_Paulo`.
- Pontuação: quantidade de artes registradas na semana (`registry.timestamp`).
- Vercel Cron dispara `/api/cron/weekly-payout` **toda segunda às 00:10**.
- Pagamentos: 1º `0.05`, 2º `0.025`, 3º `0.015` SOL — todos com memo.
- **Idempotência**: antes de pagar, o cron confere se já existe `WeeklyPayout`
  pra semana. A Vercel reexecuta cron que dá timeout; sem essa trava, o prêmio
  sai duas vezes.

```json
// vercel.json
{ "crons": [{ "path": "/api/cron/weekly-payout", "schedule": "10 3 * * 1" }] }
```

> Cron da Vercel roda em UTC. `10 3 * * 1` = segunda 00:10 em Brasília (UTC-3).

---

## 4. Captura só pela câmera

### O problema com a solução óbvia

O código atual usa `<input type="file" accept="image/*" capture="environment">`.
**`capture` é uma dica, não uma trava**: no iOS Safari abre a câmera, no
Android depende do fabricante, e no desktop é ignorado — abre o seletor de
arquivos normal. Qualquer pessoa registra uma foto baixada do Google Imagens.
Como o produto todo depende de arte urbana ser real e estar onde diz estar,
isso não serve.

### A solução

**`getUserMedia` + `<video>` + `canvas`.** O app abre um viewfinder ao vivo e
o usuário fotografa dentro do app. Os pixels vêm de um `MediaStream` — não
existe caminho de código que ponha um arquivo da galeria ali. Isso não é
"mais difícil de burlar", é **estruturalmente impossível** pela UI.

```js
// lib/capture/useCamera.js — essência
const stream = await navigator.mediaDevices.getUserMedia({
  video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } },
  audio: false,                                  // vídeo sem áudio, por espec.
});
// foto:  canvas.drawImage(videoEl) → toBlob('image/jpeg', 0.9)
// vídeo: new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' })
```

**Reforços no metadado** (defesa em profundidade, não substituem o acima):

- `capturedAt` gravado no momento do clique e comparado com o `timestamp`
  assinado no registro — divergência grande = suspeito
- GPS lido **junto** com a captura, não depois
- imagem gerada por canvas **não tem EXIF**; um JPEG chegando com EXIF de
  câmera denuncia que veio de arquivo

**Fallback**: `getUserMedia` exige HTTPS (ok, Vercel) e pode ser negado pela
permissão. Sem câmera, o registro é **bloqueado com explicação** — não cai
pro seletor de arquivos, senão a trava não vale nada. O `Permissions-Policy`
no `next.config.mjs` já libera `camera=(self)`.

**Vídeo curto sem áudio**: `audio: false` no getUserMedia, limite de 10s,
`video/webm;codecs=vp9`. Metadata Metaplex vira `properties.category: "video"`.

### Abrir no Google Maps

Um botão no card da arte (mapa e feed):

```js
`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
```

Formato universal — abre o app nativo no celular e o site no desktop.
Precisa liberar `https://www.google.com` no CSP do `next.config.mjs`.

---

## 5. Animação 3D do pacote — prompts

### 5.1 Prompt para gerar o componente R3F

> Crie um componente React chamado `Pack3D.jsx` usando React Three Fiber e
> drei, que anima a abertura de um pacote de figurinhas de arte urbana.
>
> **Cena:** fundo transparente, câmera perspectiva 35mm em `[0, 0, 5]`, luz
> ambiente fraca (0.4) + spot key quente vinda de cima-esquerda + rim light
> ciano `#2DD4BF` por trás pra recortar a silhueta contra o fundo escuro.
>
> **Estados** — máquina de estados explícita, uma prop `state`:
> 1. `idle` — pacote flutuando, rotação lenta em Y (0.3 rad/s), bob senoidal
>    sutil em Y. Material com leve iridescência, como embalagem metalizada.
> 2. `tearing` — disparado pelo toque. O plano frontal do pacote se divide em
>    duas metades ao longo de uma borda **irregular** (não uma linha reta —
>    gere o recorte com ruído 1D pra parecer papel rasgado). As metades
>    giram pra fora em eixos opostos e caem com gravidade fake, saindo do
>    frustum em ~0.8s.
> 3. `revealing` — a figurinha (plano com a textura da arte) sobe do interior,
>    escala 0.6→1, com overshoot elástico. Burst de partículas na cor da
>    raridade. Bloom curto (EffectComposer + UnrealBloomPass) com pico em
>    120ms e decaimento em 400ms.
> 4. `revealed` — figurinha estática de frente pra câmera, brilho especular
>    varrendo devagar da esquerda pra direita, em loop.
>
> **Raridade** controla cor das partículas, intensidade do bloom e presença
> de foil holográfico: comum `#8A93A2` sem foil · raro `#2DD4BF` · épico
> `#8B7CF6` · lendário `#FBBF24` com foil holográfico animado (shader com
> gradiente de matiz deslocando conforme o ângulo de visão).
>
> **Requisitos técnicos, não negociáveis:**
> - Mobile-first: `dpr={[1, 2]}` limitado, `frameloop="demand"` no `idle`
> - Respeitar `prefers-reduced-motion`: se ativo, pula direto pro `revealed`
>   com um crossfade simples
> - Todas as geometrias e materiais em `useMemo`; nada de alocação no
>   `useFrame`
> - `dispose()` de texturas e geometrias no cleanup do efeito
> - Fallback: se WebGL não estiver disponível, renderizar a versão 2D em
>   CSS (`StickerCard.jsx`) sem quebrar
> - Callback `onRevealed` disparado ao entrar em `revealed`
> - Toda a animação com `useFrame` + refs — **nenhum `setState` por frame**
>
> **Alvo:** 60fps num Pixel 6a. Menos de 8 draw calls.

### 5.2 Prompt para gerar as texturas do pacote

> Textura de embalagem de pacote de figurinhas, estética cyber-urbana:
> plástico metalizado escuro grafite com respingos sutis de tinta spray nas
> bordas, faixa diagonal em ciano néon (#2DD4BF), tipografia condensada
> stencil, textura de concreto desgastado em overlay a 15% de opacidade,
> reflexo especular suave. Tileable, 1024×1024, sem texto legível, sem
> logotipo. PNG com canal alpha.

Variantes por raridade: trocar a faixa ciano por violeta (#8B7CF6, épico) ou
dourada com granulação holográfica (#FBBF24, lendário).

### 5.3 Dependências

```bash
npm i three @react-three/fiber @react-three/drei @react-three/postprocessing
```

`three` pesa ~600 KB gzip. **Obrigatoriamente** carregado com
`next/dynamic({ ssr: false })` e só quando o pacote for aberto — nunca no
bundle da home. A home é um mapa; ninguém deve baixar uma engine 3D pra vê-la.

---

## 6. Segurança — o que precisa de atenção

### O claim é um faucet, e faucet é alvo

O endpoint manda SOL real pra qualquer carteira que peça. O ataque óbvio: mil
carteiras novas, mil claims, treasury zerada de madrugada. Assinatura de
carteira **não** ajuda aqui — gerar carteira é grátis e instantâneo.

Camadas implementadas (parâmetros em `lib/config.js`):

| Camada | Parâmetro | O que impede |
|---|---|---|
| Teto diário global | `DAILY_TREASURY_BUDGET_SOL = 2` | Drenagem completa — o pior caso vira 2 SOL/dia |
| Reserva mínima | `TREASURY_RESERVE_SOL = 0.5` | Faucet comer o dinheiro dos prêmios |
| Exigir 1 arte antes do 1º claim | `REQUIRE_ART_BEFORE_FIRST_CLAIM` | Inverte a economia do sybil: o atacante paga o mint antes de receber |
| Rate limit por IP | `/api/claim` | Automação trivial |
| Verificação na chain antes de pagar | — | Double-claim por race ou retry |

O mais eficaz é o terceiro: registrar uma arte custa ~0.0115 SOL **do bolso do
atacante**, e o primeiro claim devolve ~0.0345. Ainda é lucrativo, então o teto
diário continua sendo necessário. Se virar problema real, o passo seguinte é
exigir que a arte tenha GPS distinto e foto distinta das demais — o que já
temos como dado.

**Isto é devnet.** Em mainnet nada disso é suficiente sozinho; precisaria de
prova de humanidade (Civic, World ID) ou custo de entrada real.

### Outros pontos

- `TREASURY_SECRET_KEY` **nunca** com prefixo `NEXT_PUBLIC_`. Só
  `NEXT_PUBLIC_TREASURY_ADDRESS` (a pubkey) vai pro cliente.
- `/api/cron/weekly-payout` precisa checar o header `Authorization: Bearer
  $CRON_SECRET` — senão qualquer um dispara a premiação por HTTP.
- Bio e handle passam por `lib/sanitize.js` antes de persistir.
- Socials guardam **handle**, nunca URL — o app monta a URL a partir de
  `SOCIAL_PLATFORMS`. Sem isso o campo vira vetor de link arbitrário.
- Upload de avatar: mesmo `/api/upload` que já valida magic bytes.

---

## 7. Estado atual e ordem de implementação

### Fundação (feita)

| Arquivo | O que é |
|---|---|
| `lib/config.js` | Todos os números do jogo, com override por env |
| `lib/collections.js` | Nomes das coleções do Pinata, versionados |
| `lib/treasury.js` | Signer server-side: saldo + transferência com memo |
| `types/social.ts` | Shapes modelados como contas Anchor (Fase 2) |
| `.env.local` / `.env.example` | `TREASURY_SECRET_KEY` + `NEXT_PUBLIC_TREASURY_ADDRESS` |

**Carteira do projeto (devnet):** `5arzYD6ie4rs9hqk3ffiNWjZoxdBB3N393KYYQNVsi9m`

### Feature 1 — Perfil ✅

| Arquivo | O que é |
|---|---|
| `lib/social/profile.js` | Normalização e validação — puro, roda nos dois lados |
| `lib/social/profileSignature.js` | Mensagem canônica + hash do conteúdo (FNV-1a) |
| `lib/social/weekly.js` | Janela da semana ISO (BRT) + apuração do ranking |
| `lib/social/stats.js` | Stats derivadas, nunca persistidas |
| `lib/social/avatar.js` | Recorte quadrado central da foto de perfil |
| `lib/hooks/useProfile.js` | Perfil de terceiro, com cache e dedupe de requests |
| `context/ProfileContext.jsx` | Perfil próprio: carrega, assina e salva |
| `pages/api/profile.js` | GET perfil + stats · POST com verificação ed25519 |
| `pages/perfil/[wallet].jsx` | Perfil público + galeria do artista |
| `components/profile/*` | Avatar, AvatarUpload, StatsGrid, SocialLinks, ProfileCard, ProfileSheet |

**Por que o hash do conteúdo entra na mensagem assinada:** sem ele, uma
assinatura capturada de uma edição legítima poderia ser reenviada com outro
corpo dentro da janela de 10 minutos, deixando qualquer um reescrever o perfil
alheio. Verificado por teste: adulterar bio, handle, avatar ou carteira em
trânsito derruba a verificação; enviar o corpo cru (não normalizado) continua
passando, porque servidor e cliente normalizam com o mesmo código.

### Feature 2 — Claim + streak ✅

| Arquivo | O que é |
|---|---|
| `lib/social/claim.js` | Regra pura: cooldown, streak, ciclo, reserva (42 testes) |
| `lib/social/claimSignature.js` | Mensagem canônica + dia BRT do claim |
| `lib/rateLimit.js` | Limite por IP em memória (best-effort — ver o topo do arquivo) |
| `pages/api/claim.js` | GET status · POST com 8 camadas de trava |
| `context/ClaimContext.jsx` | Estado do claim; sem tick de 1s de propósito |
| `components/claim/*` | StreakTracker, ClaimButton, ClaimSheet, ClaimResultModal |

**Pendente de teste ao vivo:** o caminho feliz completo (reserva →
transferência → confirmação) só roda com a treasury financiada. Todas as
camadas de recusa foram verificadas contra o servidor em execução.

### Feature 3 — Metaplex Core ✅

| Arquivo | O que é |
|---|---|
| `lib/solana/confirm.js` | Polling de confirmação (era copiado em 4 arquivos) |
| `lib/solana/standard.js` | Detecta Core vs Token Metadata pelo dono da conta |
| `lib/mint.js` | Mint via `create` do mpl-core |
| `lib/nftTransfer.js` · `lib/vaultSigner.js` · `lib/useMyNfts.js` | Roteiam os dois padrões |
| `pages/api/arts.js` | Busca `nonFungible` **e** `MplCoreAsset` no DAS |

**Custo medido on-chain** (devnet, 2026-07-24): rent 0.00332352 + fee 0.0000506
= **0.00337412 SOL**. A estimativa da documentação era 0.0029 — orçar por baixo
faria o claim cobrir 2.58 mints e quebrar a promessa de 3 artes/dia, então
`ART_MINT_COST_SOL` ficou em **0.0035**.

O acervo anterior continua Token Metadata e segue transferível e vendável —
quebrar isso apagaria na prática o histórico dos usuários.

### Feature 4 — Captura por câmera ✅

`lib/capture/useCamera.js` + `components/capture/CameraCapture.jsx`.
`getUserMedia` + `<video>` + `<canvas>`: **não existe input de arquivo no
fluxo de registro**. Vídeo até 10s, sem áudio, a 2.5 Mbps (1080p sem teto
estouraria o limite de 12 MB de `/api/upload`, já que base64 infla 33%).
Câmera negada bloqueia com explicação — não cai pro seletor de arquivos,
senão a garantia não valeria nada.

Botão "Como chegar" (Google Maps) no popup do mapa e no feed.

### Feature 5 — Figurinhas e álbum ✅

| Arquivo | O que é |
|---|---|
| `lib/stickers/rarity.js` | Sorteio de raridade e de arte |
| `lib/stickers/album.js` | Monta o álbum, conta pacotes |
| `lib/stickers/mintSticker.js` | Mint pela treasury, direto na carteira do usuário |
| `pages/api/stickers.js` | GET álbum · POST abrir/colar |
| `components/stickers/*` · `pages/album.jsx` | UI |

**Sorteio ponderado pelo inverso da circulação.** Com sorteio uniforme, as
primeiras artes registradas apareceriam em quase todas as figurinhas — elas
acumulam sorteios desde o começo enquanto as novas entram com zero. Medido:
uma arte com 9 figurinhas em circulação cai para **3,2%** contra ~32% das
inéditas.

**Colar vs trocar** — resolve a tensão do requisito "não pode remover, mas
pode trocar", funcionando como álbum de figurinha de verdade: figurinha nova
cai no bolso; slot vazio → dá pra colar (irreversível); slot cheio → é
repetida, e repetida é o que circula na troca. Nada sai do álbum depois de
colado.

**A imagem da figurinha é a arte, sem moldura embutida.** Compor no servidor
exigiria canvas nativo numa função serverless — dezenas de MB de dependência
pra gravar no IPFS uma moldura que o app desenha em CSS de graça. O que
precisa ser permanente é o **crédito ao artista**, e isso vai nos atributos
on-chain.

### Feature 6 — Animação 3D ✅

`components/stickers/Pack3D.jsx` (React Three Fiber). Rasgo com borda
irregular gerada por ruído 1D — corte reto pareceria guilhotina, não papel.
Partículas e bloom na cor da raridade; foil holográfico só no lendário.

Toda animação em `useFrame` mutando refs, zero `setState` por frame;
geometrias e materiais em `useMemo`; `dispose()` no desmonte. Carregado por
`dynamic({ ssr: false })` — **`/album` são 7 kB**, o three.js só entra quando
um pacote é aberto. Sem WebGL ou com `prefers-reduced-motion`, cai pro card
2D sem perder a figurinha, que já está mintada.

> Versões: `@react-three/fiber` **8.17.10** e `drei` **9.114.3**. As v9/v10
> exigem React 19 e quebram neste projeto, que está no 18.

### Feature 7 — Ranking e premiação ✅

`pages/api/ranking.js`, `pages/ranking.jsx`, `pages/api/cron/weekly-payout.js`,
cron em `vercel.json` (`10 3 * * 1` = segunda 00:10 BRT).

A tela e o cron usam a **mesma** função de apuração (`lib/social/weekly.js`) —
duas implementações poderiam mostrar um pódio e pagar outro.

Duas proteções não opcionais: `CRON_SECRET` em comparação de tempo constante
(a rota é pública por natureza) e idempotência pela semana ISO (a Vercel
reexecuta cron que dá timeout).

### Feature 8 — Troca de figurinhas ✅

`pages/api/trades.js` + `components/stickers/TradeModal.jsx`.

Atômica **sem programa on-chain**, via a vault custodial que o marketplace já
usa: quem propõe deposita; quem aceita deposita; o servidor confirma que a
vault tem **as duas** e só então distribui. Não existe estado em que um lado
entregou e o outro não. Recusa, cancelamento e expiração (48h) devolvem.

---

## 8. Correção de segurança aplicada durante a implementação

`getLatestPin` engolia falhas de leitura e devolvia o fallback vazio. Para
exibição isso é correto — o feed mostrando zero curtidas porque o gateway
piscou é irrelevante. Mas **quando a leitura decide um pagamento**, "não
consegui ler" ficava indistinguível de "nunca paguei":

- cron de premiação: histórico ilegível → pagaria o pódio **de novo**
- claim: estado ilegível → liberaria um resgate **já pago hoje**
- ledger do faucet: ilegível → o teto diário seria **furado**
- pacotes: ilegível → mints infinitos pagos pela treasury

Foi adicionado `getLatestPinStrict`, que **falha em vez de devolver vazio**, e
aplicado nessas quatro leituras. Verificado: com credencial inválida, o cron
aborta em 500 enquanto todas as telas seguem em 200.

**Regra:** leitura que resulta em transferência de SOL ou mint pago pela
treasury usa a versão estrita. Leitura que só preenche tela usa a tolerante.

---

## 9. Pendências conhecidas

- **Reorganização de pastas**: as pastas novas (`lib/social/`, `lib/stickers/`,
  `lib/capture/`, `lib/solana/`, `components/profile/`…) já seguem a estrutura
  de §1, mas os arquivos antigos do marketplace continuam flat. Mover
  `lib/market/*` e agrupar `components/` é um refactor de risco próprio —
  vale fazer num commit só de movimentação, quando tudo estiver estável.
- **Troca por endereço colado**: o TradeModal pede a carteira e o mint da
  figurinha desejada digitados. O caminho natural seria navegar pelo álbum de
  outra pessoa e tocar na figurinha — depende de uma tela de álbum público,
  que não existe ainda.
---

## 10. Fase 2 — integração com o programa `urban_social` ✅

O programa foi escrito, deployado na devnet e **integrado ao app**. A camada de
acesso não usa `@coral-xyz/anchor`: o cliente oficial arrasta ~500 kB e uma
versão própria do `@solana/web3.js` que conflita com a 1.98.4 fixada aqui, em
troca de derivação de PDA, oito bytes de discriminador e Borsh de campos
escalares — que `lib/anchor/urbanProgram.js` faz em 200 linhas.

| Arquivo | O que é |
|---|---|
| `lib/anchor/urban_social.idl.json` | IDL fiel ao `lib.rs` — fonte dos discriminadores |
| `lib/anchor/urbanProgram.js` | PDAs, codec Borsh, instruções, tradução dos erros |
| `lib/anchor/rpc.js` | `getAccountInfo` isomórfico (proxy no browser, Helius no servidor) |
| `lib/anchor/onchainClaim.js` | Leitura do streak + envio do `claim_daily` |
| `lib/anchor/onchainProfile.js` | Leitura e gravação do perfil |
| `pages/api/admin/treasury.js` | Cria, abastece e inspeciona o cofre (protegida por `CRON_SECRET`) |

### O que mudou de fato

- **Claim**: o usuário assina a transação; o servidor saiu do caminho.
  `POST /api/claim` responde **410**. Sumiram a reserva prévia, os dois
  rollbacks e o log de "transferiu mas não confirmou" — a transação é atômica.
- **Perfil**: leitura híbrida (conta on-chain vence; sem ela, o pin do Pinata).
  A gravação on-chain é uma ação explícita (`anchorProfile`), não parte do
  salvar — criar a conta custa ~0.0037 SOL de rent, **mais** que o claim de
  boas-vindas paga, e o app pede o perfil ANTES de liberar as boas-vindas.
  Torná-la obrigatória fecharia o onboarding num impasse.
- **Premiação**: `pay_weekly_prize` a partir do cofre. A idempotência virou
  garantia do runtime (`init` no PDA `["payout", semana, posição]`), em vez de
  depender de conseguir ler o histórico antes de pagar.
- **Figurinhas e trocas**: `completedCycles` passou a ser lido da chain
  (`pages/api/stickers.js`, `pages/api/trades.js`). Continuar lendo o pin daria
  o número congelado no dia da migração.

### O que a migração CUSTOU — e é honesto registrar

A trava **"precisa ter registrado uma arte antes do primeiro claim"** era
aplicada no servidor, e era a defesa anti-sybil mais eficaz do app. O programa
não a implementa, e como o servidor não assina mais a transação, não há onde
impor. Sobrou como orientação na interface (`needsArt`), que quem monta a
transação na mão ignora. O que limita o prejuízo agora é o teto diário do
cofre, aplicado on-chain.

Impor isso de novo exigiria um co-signer do servidor em `ClaimDaily` — ou seja,
um upgrade do programa.

### Streaks: recomeçaram do zero

Decisão tomada em 2026-07-25. O programa não tem instrução de importação, e
criar uma daria ao operador o poder de escrever qualquer streak — exatamente a
fraqueza que a migração veio remover. O pin `CLAIMS` **não foi apagado**: segue
exposto em `legacy` no `GET /api/claim`, só para exibição, e a `ClaimSheet`
avisa que o histórico continua guardado.

### O incidente do `declare_id` — resolvido em 2026-07-25

O primeiro deploy subiu o binário compilado com o `declare_id!` **placeholder**
(`Fg6PaFpo…`), então o Anchor recusava TODA instrução com
`DeclaredProgramIdMismatch` (0x1004) — o programa aparecia executável no
explorer e mesmo assim não fazia nada. Diagnosticado lendo o ELF da conta de
programdata e procurando os 32 bytes do id.

Corrigido com rebuild (`cargo-build-sbf`) e `solana program deploy` no mesmo
endereço, pela authority `Au6QSoLYQoSWwxmgdRbpfkPorPf1eM5FTXfsVbZQQXgW`.
O alerta em `programs/DEPLOY.md § 4` documenta a armadilha e como conferir.

### Estado on-chain (devnet, 2026-07-25)

| | |
|---|---|
| Program Id | `HyPVy5NLqnqxnxuXH5VgoXAxJM2FRrpf3cTvEPRLcNJy` |
| Cofre (PDA `["treasury"]`) | `57BvNuavWnLQF5wc3DBQsRNeQoNvJAyd13qvxfJ3jF7U` — 2 SOL, teto diário 2 SOL |
| Authority do cofre | a treasury (`5arzYD6i…`), que assina `pay_weekly_prize` |
| Keypair da treasury | 5,43 SOL — continua pagando o claim de boas-vindas e o mint das figurinhas |

**A keypair não some com o cofre no ar.** Boas-vindas e figurinhas seguem
off-chain, e esvaziá-la quebraria as duas coisas — por isso `/api/admin/treasury`
recusa um `fund` que a deixe abaixo de 0,5 SOL.

Verificado de ponta a ponta na devnet: `claim_daily` pagou 0,0105 SOL, criou o
`ClaimState` com streak 1, e a segunda tentativa imediata foi recusada com
`ClaimOnCooldown`. O `GET /api/claim` devolve `onChain: true` para quem tem
conta e o histórico antigo em `legacy` para quem não tem.
