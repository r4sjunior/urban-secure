# Deploy do programa `urban_social` na devnet

## Antes de tudo: Remix não serve aqui

Remix IDE compila **Solidity** e deploya em redes **EVM** (Ethereum, Polygon,
Base…). Solana é outra máquina virtual: programas são escritos em Rust,
compilados para **SBF** e enviados pelo *BPF Loader*. Não existe caminho do
Remix até a Solana — o Phantom nem sequer expõe uma API que o Remix saiba usar
para deploy de programa.

O equivalente direto do Remix no mundo Solana é o **Solana Playground**
(`beta.solpg.io`): IDE no navegador, compila Anchor, deploya na devnet, sem
instalar Rust nem WSL. É o caminho deste guia.

| | Remix | Solana Playground |
|---|---|---|
| Linguagem | Solidity | Rust / Anchor |
| Redes | EVM | Solana |
| Instalação | nenhuma | nenhuma |
| Carteira | MetaMask | Phantom ou carteira embutida |

---

## Sobre o Phantom no deploy

Você pediu para deployar conectado à sua Phantom. Dá para conectá-la ao
Playground, mas **não é o caminho que eu recomendo para o deploy em si**, e o
motivo é prático:

O binário do programa tem centenas de KB e não cabe numa transação (limite de
1232 bytes). O deploy é feito em **~150 a 250 transações** que escrevem o
binário em pedaços num buffer. Com a Phantom conectada, você aprovaria um
popup para cada uma. Não é inseguro — é inviável.

**O caminho prático:**

1. Use a **carteira embutida do Playground** para o deploy (ela aprova as
   transações em lote sem popups).
2. Defina a **sua Phantom como `authority`** do programa e da treasury.

Assim o deploy é rápido e o controle continua sendo seu: a carteira do
Playground é descartável, e quem manda no programa é a Phantom. Todas as
instruções que exigem privilégio (`set_daily_budget`, `pay_weekly_prize`)
verificam `has_one = authority` contra a chave que você definir.

---

## Passo a passo

### 1. Abrir o Playground

Acesse **https://beta.solpg.io** → `Create a new project` → nome
`urban_social` → framework **Anchor (Rust)**.

### 2. Colar o programa

Abra `src/lib.rs` no painel esquerdo, apague o conteúdo de exemplo e cole todo
o conteúdo de **`programs/urban_social/src/lib.rs`** deste repositório.

O Playground gerencia o `Cargo.toml` automaticamente, mas ele **não habilita
`init-if-needed` sozinho**. Abra o `Cargo.toml` do projeto no Playground e
garanta que a dependência esteja assim:

```toml
anchor-lang = { version = "0.30.1", features = ["init-if-needed"] }
```

Sem isso o build falha com `init_if_needed requires the init-if-needed
cargo feature`.

### 3. Criar e financiar a carteira do Playground

No canto inferior esquerdo, clique em **`Not connected`** → `Create wallet`.
Guarde a chave que ele mostrar (é descartável, mas você vai querer recuperar
o SOL depois).

Confirme que está em **devnet**: canto inferior → deve dizer `devnet`.

Agora financie essa carteira. Duas opções:

**a) Faucet** (mais simples):
```
solana airdrop 5
```
direto no terminal embutido do Playground.

**b) Da sua Phantom**: copie o endereço da carteira do Playground e envie
~5 SOL de devnet da sua Phantom.

> **Quanto custa o deploy:** o programa fica permanentemente numa conta, e
> contas Solana pagam *rent-exempt* proporcional ao tamanho. Um programa
> Anchor deste porte dá ~250 KB, o que custa **~2 SOL**. Durante o envio
> existe um buffer temporário do mesmo tamanho, então tenha **~5 SOL** na
> carteira do Playground para o deploy passar com folga. O buffer é
> reembolsado ao final.
>
> Você tem 6,99 SOL na treasury atual — se precisar, mande de lá.

### 4. Build

Terminal do Playground:
```
build
```

Espere `Build successful`. Se der erro, ele aponta a linha — o mais comum é
o `init-if-needed` do passo 2.

### 5. Deploy

```
deploy
```

Leva 1–3 minutos. No fim ele imprime o **Program Id**. **Copie e guarde** —
é o endereço do seu programa, e o app inteiro vai apontar para ele.

O Playground já injeta esse id no `declare_id!` ao buildar, então você não
precisa editar nada manualmente.

### 6. Inicializar a treasury

Ainda no Playground, aba **`Test`** (ícone de frasco) — ela lista as
instruções do programa a partir do IDL gerado.

Chame **`initTreasury`** com:

| Campo | Valor |
|---|---|
| `dailyBudget` | `2000000000` (2 SOL em lamports) |
| `authority` | **o endereço da sua Phantom** |
| `treasury` | o Playground deriva sozinho (PDA `["treasury"]`) |

> Se a aba Test não deixar escolher a authority (ela usa o signatário por
> padrão), rode o `initTreasury` conectando a Phantom só para esta chamada —
> é **uma** transação, um popup. É a única em que a carteira importa de
> verdade, porque define quem manda no cofre para sempre.

### 7. Depositar SOL no cofre

Chame **`fundTreasury`** com `amount` em lamports. Por exemplo, 3 SOL:

```
3000000000
```

Pode ser assinado pela Phantom — é uma transação só.

**Importante:** não existe instrução de saque neste programa. O SOL depositado
só sai como claim diário ou prêmio semanal. Isso é intencional (nem você
consegue sacar), então deposite o que pretende distribuir, não a reserva
inteira do projeto.

### 8. Testar o claim

Chame **`claimDaily`** com sua Phantom. Deve transferir 0,0105 SOL e criar a
conta de claim. Chame de novo imediatamente: precisa falhar com
`ClaimOnCooldown` — é a prova de que a trava de 20h está valendo on-chain.

---

## Como conectar isto ao app

O deploy sozinho não muda o app: hoje ele fala com `/api/claim`, que usa o
Pinata e a keypair da treasury. A migração é um trabalho próprio, e a ordem
importa:

1. Salvar o Program Id em `NEXT_PUBLIC_URBAN_PROGRAM_ID`.
2. Baixar o IDL do Playground (`Export IDL`) para `lib/idl/urban_social.json`.
3. Criar `lib/program/client.js` derivando os PDAs e montando as instruções.
4. Trocar o `claim` do cliente: em vez de `POST /api/claim`, montar e enviar
   a transação `claimDaily`. O usuário passa a assinar uma transação (e pagar
   ~0,000005 SOL de taxa) em vez de assinar uma mensagem grátis — é o
   trade-off honesto da mudança.
5. Manter o estado off-chain em paralelo por algumas semanas, comparando os
   dois. Só depois desligar o caminho antigo.

Repare que o passo 5 não é excesso de zelo: as contas on-chain começam
vazias, então todo mundo que já tem streak hoje voltaria a zero no dia da
virada. Ou você aceita isso (e avisa antes), ou escreve uma instrução de
migração que semeia as contas a partir do estado atual.

---

## O que o programa garante (e o que não)

**Garante:**

- Streak não é forjável. O incremento é validado contra `Clock` do cluster.
- A treasury não tem dono com poder de saque. O SOL só sai pelas regras deste
  arquivo — nem a authority consegue tirar.
- O teto diário é aplicado on-chain, então o prejuízo máximo de um dia é
  conhecido mesmo se o servidor for comprometido.
- A premiação não paga duas vezes: o PDA `["payout", semana, posição]` com
  `init` falha na segunda tentativa. É uma garantia do runtime, não uma
  checagem que pode falhar por leitura ruim.

**Não garante:**

- **Sybil.** Carteira nova é grátis; mil carteiras continuam valendo mil
  claims, limitados só pelo teto diário. Colocar o claim on-chain não muda
  isso — quem disser o contrário está confundindo integridade com identidade.
- **Que a arte é real.** Isso continua sendo garantido pela captura por
  câmera no cliente.
- **Autoridade do upgrade.** Enquanto o programa for atualizável, quem tiver a
  upgrade authority pode trocar as regras. Para tornar as garantias acima
  definitivas, rode:
  ```
  solana program set-upgrade-authority <PROGRAM_ID> --final
  ```
  Isso é **irreversível** — não faça antes de o programa estar rodando em
  produção há um tempo.

---

## Se preferir a linha de comando

O Playground é o caminho mais curto no Windows, mas dá para fazer local:

```bash
# Exige WSL2 no Windows
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
cargo install --git https://github.com/coral-xyz/anchor avm --locked
avm install 0.30.1 && avm use 0.30.1

anchor init urban_social
# cole lib.rs e Cargo.toml deste repositório
anchor keys sync
anchor build
anchor deploy --provider.cluster devnet
```
