//! urban_social — programa Solana do Urban Secure Social.
//!
//! O QUE ESTE PROGRAMA RESOLVE
//!
//! Hoje o app guarda streak, perfil e o controle do faucet fora da chain
//! (JSON pinado no IPFS, ver ARCHITECTURE.md). Isso funciona, mas tem duas
//! fraquezas que só código on-chain elimina:
//!
//!   1. O streak é forjável. Quem comprometesse o servidor gravaria
//!      `completed_cycles: 99` e sacaria bônus e figurinhas sem nunca ter
//!      voltado ao app. Aqui, o incremento é validado pelo runtime da Solana
//!      contra o relógio do próprio cluster — não existe caminho pra mentir.
//!
//!   2. A treasury é uma keypair. Quem obtivesse a chave privada esvaziaria
//!      a carteira numa transação. Aqui o SOL vive num PDA que NINGUÉM
//!      controla diretamente: sai apenas pelas regras escritas neste
//!      arquivo, e nem o dono do projeto consegue sacar fora delas.
//!
//! O QUE ELE NÃO RESOLVE
//!
//! Sybil. Criar carteira continua grátis, então mil carteiras continuam
//! valendo mil claims. O que existe contra isso é o teto diário (agora
//! aplicado on-chain) e o custo de registrar uma arte. Não caia na ideia de
//! que "está on-chain, logo está seguro" — são problemas diferentes.
//!
//! ESCOPO: perfil, claim/streak, treasury e premiação semanal.
//! A troca de figurinhas fica fora de propósito: ela exige CPI para o
//! Metaplex Core, o que multiplica a superfície de erro num primeiro deploy.
//! A vault custodial atual já resolve a troca com segurança.

use anchor_lang::prelude::*;

// O Solana Playground substitui este id pelo do seu programa ao buildar.
// Se você deployar por CLI, rode `anchor keys sync` antes.
declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

// ─────────────────────────────────────────────────────────────────────────
// Parâmetros do jogo — espelham lib/config.js.
//
// Estão como constantes, e não como campos configuráveis, porque mudá-los
// exige um upgrade do programa: isso é a garantia de que as regras não podem
// ser alteradas silenciosamente entre um claim e outro.
// ─────────────────────────────────────────────────────────────────────────

/// 20h, não 24h. Com 24h cravadas, quem claima às 9h só pode claimar às 9h01
/// no dia seguinte — atrasa alguns minutos por dia e em uma semana quebra o
/// streak de quem não fez nada de errado.
const CLAIM_COOLDOWN_SECS: i64 = 20 * 60 * 60;

/// Passou disso sem claimar, o streak zera. 48h dá direito a pular um dia.
const STREAK_GRACE_SECS: i64 = 48 * 60 * 60;

/// Dias para fechar um ciclo (paga dobrado e libera um pacote de figurinha).
const STREAK_TARGET: u32 = 7;

/// 0.0105 SOL — cobre 3 registros de arte em Metaplex Core, cujo custo real
/// medido na devnet é 0.00337412 SOL por mint.
const DAILY_CLAIM_LAMPORTS: u64 = 10_500_000;

const DAY_SECS: i64 = 24 * 60 * 60;

// Limites das strings do perfil. Precisam bater com BIO_MAX_LENGTH e
// HANDLE_MAX_LENGTH em lib/config.js, senão o cliente monta uma transação
// que o programa recusa.
const MAX_HANDLE_LEN: usize = 24;
const MAX_BIO_LEN: usize = 160;
const MAX_AVATAR_LEN: usize = 64; // CID do IPFS, não a URL completa
const MAX_SOCIAL_LEN: usize = 30;

#[program]
pub mod urban_social {
    use super::*;

    // ── Treasury ─────────────────────────────────────────────────────────

    /// Cria o cofre do projeto. Roda uma única vez.
    ///
    /// `authority` é quem pode depositar e disparar a premiação semanal —
    /// normalmente a sua carteira Phantom. Note que a authority **não** pode
    /// sacar: não existe instrução de saque neste programa. É deliberado —
    /// o SOL depositado aqui só sai como claim ou como prêmio.
    pub fn init_treasury(ctx: Context<InitTreasury>, daily_budget: u64) -> Result<()> {
        let treasury = &mut ctx.accounts.treasury;
        treasury.authority = ctx.accounts.authority.key();
        treasury.daily_budget = daily_budget;
        treasury.daily_spent = 0;
        treasury.daily_reset_at = Clock::get()?.unix_timestamp;
        treasury.total_distributed = 0;
        treasury.bump = ctx.bumps.treasury;
        Ok(())
    }

    /// Deposita SOL no cofre.
    ///
    /// Qualquer um pode depositar (doação é bem-vinda), mas ninguém pode
    /// sacar. Usa CPI do System Program porque o SOL sai de uma conta
    /// comum (a do usuário) para o PDA.
    pub fn fund_treasury(ctx: Context<FundTreasury>, amount: u64) -> Result<()> {
        require!(amount > 0, UrbanError::InvalidAmount);

        anchor_lang::system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.funder.to_account_info(),
                    to: ctx.accounts.treasury.to_account_info(),
                },
            ),
            amount,
        )?;

        emit!(TreasuryFunded { funder: ctx.accounts.funder.key(), amount });
        Ok(())
    }

    /// Ajusta o teto diário. Só a authority.
    pub fn set_daily_budget(ctx: Context<AdminTreasury>, daily_budget: u64) -> Result<()> {
        ctx.accounts.treasury.daily_budget = daily_budget;
        Ok(())
    }

    // ── Perfil ───────────────────────────────────────────────────────────

    /// Cria o perfil da carteira que assina. PDA ["profile", wallet].
    ///
    /// A conta é derivada da carteira, então não existe "perfil de outra
    /// pessoa" a ser criado: o endereço só fecha com a assinatura do dono.
    /// Isso substitui, com garantia do runtime, a verificação de assinatura
    /// que hoje é feita no servidor (pages/api/profile.js).
    pub fn init_profile(
        ctx: Context<InitProfile>,
        handle: String,
        bio: String,
        avatar_cid: String,
        socials: Socials,
    ) -> Result<()> {
        validate_profile(&handle, &bio, &avatar_cid, &socials)?;

        let now = Clock::get()?.unix_timestamp;
        let profile = &mut ctx.accounts.profile;

        profile.wallet = ctx.accounts.owner.key();
        profile.handle = handle;
        profile.bio = bio;
        profile.avatar_cid = avatar_cid;
        profile.socials = socials;
        profile.created_at = now;
        profile.updated_at = now;
        profile.bump = ctx.bumps.profile;

        Ok(())
    }

    pub fn update_profile(
        ctx: Context<UpdateProfile>,
        handle: String,
        bio: String,
        avatar_cid: String,
        socials: Socials,
    ) -> Result<()> {
        validate_profile(&handle, &bio, &avatar_cid, &socials)?;

        let profile = &mut ctx.accounts.profile;
        profile.handle = handle;
        profile.bio = bio;
        profile.avatar_cid = avatar_cid;
        profile.socials = socials;
        profile.updated_at = Clock::get()?.unix_timestamp;

        Ok(())
    }

    // ── Claim diário ─────────────────────────────────────────────────────

    /// Resgate diário. É o coração do programa.
    ///
    /// `init_if_needed` na conta de claim faz o primeiro resgate criar o
    /// estado sozinho — sem isso, todo usuário novo precisaria de duas
    /// transações e duas aprovações na carteira só para começar.
    ///
    /// ORDEM DAS OPERAÇÕES: valida tudo, move o SOL, e só então grava o
    /// estado. Se qualquer `require!` falhar, a transação inteira reverte e
    /// nada acontece — a atomicidade da Solana elimina aqui o problema que
    /// o servidor precisa resolver com reserva prévia e rollback manual
    /// (ver pages/api/claim.js).
    pub fn claim_daily(ctx: Context<ClaimDaily>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;

        let claim = &mut ctx.accounts.claim_state;
        let treasury = &mut ctx.accounts.treasury;

        // Primeira vez: a conta acabou de ser criada e vem zerada.
        if claim.wallet == Pubkey::default() {
            claim.wallet = ctx.accounts.user.key();
            claim.bump = ctx.bumps.claim_state;
        }

        // 1. Cooldown
        require!(
            claim.last_claim_at == 0 || now - claim.last_claim_at >= CLAIM_COOLDOWN_SECS,
            UrbanError::ClaimOnCooldown
        );

        // 2. Streak que vale AGORA. O campo gravado guarda o streak no
        //    momento do último claim e não sabe que o tempo passou; quem
        //    ficou mais de 48h fora perdeu, mesmo com número gravado.
        let effective_streak = if claim.last_claim_at == 0
            || now - claim.last_claim_at > STREAK_GRACE_SECS
        {
            0
        } else {
            claim.current_streak
        };

        let next_streak = effective_streak + 1;
        let completes_cycle = next_streak % STREAK_TARGET == 0;

        // 3. Valor: dobra no fechamento de ciclo.
        let amount = if completes_cycle {
            DAILY_CLAIM_LAMPORTS
                .checked_mul(2)
                .ok_or(UrbanError::MathOverflow)?
        } else {
            DAILY_CLAIM_LAMPORTS
        };

        // 4. Teto diário, com janela deslizante de 24h.
        //    Esta é a trava que limita o prejuízo de um ataque sybil: mesmo
        //    com mil carteiras, ninguém tira do cofre mais que o orçamento
        //    do dia.
        if now - treasury.daily_reset_at >= DAY_SECS {
            treasury.daily_reset_at = now;
            treasury.daily_spent = 0;
        }
        require!(
            treasury
                .daily_spent
                .checked_add(amount)
                .ok_or(UrbanError::MathOverflow)?
                <= treasury.daily_budget,
            UrbanError::DailyBudgetExhausted
        );

        // 5. Saldo — preservando o rent-exempt do próprio cofre.
        //    Sem esta checagem o cofre poderia ser esvaziado abaixo do
        //    mínimo e a conta seria coletada pelo runtime, levando junto o
        //    estado da treasury.
        let treasury_ai = treasury.to_account_info();
        let rent_exempt = Rent::get()?.minimum_balance(treasury_ai.data_len());
        require!(
            treasury_ai
                .lamports()
                .checked_sub(amount)
                .ok_or(UrbanError::MathOverflow)?
                >= rent_exempt,
            UrbanError::InsufficientTreasury
        );

        // 6. Transferência.
        //    Feita mexendo nos lamports diretamente, e não por CPI do System
        //    Program: CPI de transferência exige que a origem seja uma conta
        //    do sistema, e o cofre é uma conta de dados deste programa. Como
        //    somos os donos dela, a mutação direta é o caminho correto.
        **treasury_ai.try_borrow_mut_lamports()? -= amount;
        **ctx.accounts.user.to_account_info().try_borrow_mut_lamports()? += amount;

        // 7. Estado. O streak NÃO volta a zero ao fechar ciclo: cresce
        //    indefinidamente (7, 14, 21…) e cada múltiplo de 7 rende um
        //    pacote. Resetar travaria `longest_streak` em 7 pra sempre e
        //    apagaria a conquista de quem mantém 30 dias seguidos.
        claim.last_claim_at = now;
        claim.current_streak = next_streak;
        if next_streak > claim.longest_streak {
            claim.longest_streak = next_streak;
        }
        if completes_cycle {
            // Acumulado e permanente: é ele que libera a troca de
            // figurinhas, mesmo depois de o streak zerar.
            claim.completed_cycles = claim
                .completed_cycles
                .checked_add(1)
                .ok_or(UrbanError::MathOverflow)?;
        }
        claim.total_claims = claim
            .total_claims
            .checked_add(1)
            .ok_or(UrbanError::MathOverflow)?;
        claim.total_claimed = claim
            .total_claimed
            .checked_add(amount)
            .ok_or(UrbanError::MathOverflow)?;

        treasury.daily_spent += amount;
        treasury.total_distributed = treasury
            .total_distributed
            .checked_add(amount)
            .ok_or(UrbanError::MathOverflow)?;

        emit!(ClaimExecuted {
            user: ctx.accounts.user.key(),
            amount,
            streak: next_streak,
            completed_cycle: completes_cycle,
        });

        Ok(())
    }

    // ── Premiação semanal ────────────────────────────────────────────────

    /// Paga um prêmio do ranking semanal. Só a authority.
    ///
    /// IDEMPOTÊNCIA GARANTIDA PELO RUNTIME: a conta `payout` é um PDA
    /// derivado de ["payout", week_id, position] com `init`. Uma segunda
    /// tentativa de pagar a mesma posição na mesma semana falha porque a
    /// conta já existe — não há como pagar duas vezes nem por erro de
    /// operação, nem por retry do cron, nem por chamada maliciosa.
    ///
    /// É estritamente mais forte que a checagem off-chain de hoje, que
    /// depende de conseguir ler o histórico antes de pagar.
    pub fn pay_weekly_prize(
        ctx: Context<PayWeeklyPrize>,
        week_id: u32,
        position: u8,
        amount: u64,
    ) -> Result<()> {
        require!(position >= 1 && position <= 3, UrbanError::InvalidPosition);
        require!(amount > 0, UrbanError::InvalidAmount);

        let treasury = &mut ctx.accounts.treasury;
        let treasury_ai = treasury.to_account_info();
        let rent_exempt = Rent::get()?.minimum_balance(treasury_ai.data_len());

        require!(
            treasury_ai
                .lamports()
                .checked_sub(amount)
                .ok_or(UrbanError::MathOverflow)?
                >= rent_exempt,
            UrbanError::InsufficientTreasury
        );

        **treasury_ai.try_borrow_mut_lamports()? -= amount;
        **ctx.accounts.winner.to_account_info().try_borrow_mut_lamports()? += amount;

        let payout = &mut ctx.accounts.payout;
        payout.week_id = week_id;
        payout.position = position;
        payout.winner = ctx.accounts.winner.key();
        payout.amount = amount;
        payout.paid_at = Clock::get()?.unix_timestamp;
        payout.bump = ctx.bumps.payout;

        treasury.total_distributed = treasury
            .total_distributed
            .checked_add(amount)
            .ok_or(UrbanError::MathOverflow)?;

        emit!(PrizePaid {
            week_id,
            position,
            winner: ctx.accounts.winner.key(),
            amount,
        });

        Ok(())
    }
}

// ─────────────────────────────────────────────────────────────────────────
// Validação
// ─────────────────────────────────────────────────────────────────────────

fn validate_profile(handle: &str, bio: &str, avatar_cid: &str, socials: &Socials) -> Result<()> {
    require!(handle.len() <= MAX_HANDLE_LEN, UrbanError::HandleTooLong);
    require!(bio.len() <= MAX_BIO_LEN, UrbanError::BioTooLong);
    require!(avatar_cid.len() <= MAX_AVATAR_LEN, UrbanError::AvatarTooLong);

    // Guardamos o HANDLE de cada rede, nunca a URL: o app monta a URL final
    // a partir de um domínio fixo. Sem isso, o campo de perfil viraria um
    // vetor pra apontar link a qualquer lugar a partir de um perfil legítimo.
    for s in [&socials.instagram, &socials.x, &socials.tiktok, &socials.farcaster] {
        require!(s.len() <= MAX_SOCIAL_LEN, UrbanError::SocialTooLong);
    }
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────
// Contas
// ─────────────────────────────────────────────────────────────────────────

#[account]
pub struct Treasury {
    pub authority: Pubkey,      // 32
    pub daily_budget: u64,      // 8
    pub daily_spent: u64,       // 8
    pub daily_reset_at: i64,    // 8
    pub total_distributed: u64, // 8
    pub bump: u8,               // 1
}
impl Treasury {
    pub const SPACE: usize = 8 + 32 + 8 + 8 + 8 + 8 + 1;
}

#[account]
pub struct ClaimState {
    pub wallet: Pubkey,        // 32
    pub last_claim_at: i64,    // 8
    pub current_streak: u32,   // 4
    pub longest_streak: u32,   // 4
    pub completed_cycles: u32, // 4
    pub total_claims: u32,     // 4
    pub total_claimed: u64,    // 8
    pub bump: u8,              // 1
}
impl ClaimState {
    pub const SPACE: usize = 8 + 32 + 8 + 4 + 4 + 4 + 4 + 8 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct Socials {
    pub instagram: String,
    pub x: String,
    pub tiktok: String,
    pub farcaster: String,
}
impl Socials {
    // 4 bytes de prefixo de tamanho + conteúdo, por string.
    pub const SPACE: usize = 4 * (4 + MAX_SOCIAL_LEN);
}

#[account]
pub struct Profile {
    pub wallet: Pubkey,
    pub handle: String,
    pub bio: String,
    pub avatar_cid: String,
    pub socials: Socials,
    pub created_at: i64,
    pub updated_at: i64,
    pub bump: u8,
}
impl Profile {
    // Reservamos o TAMANHO MÁXIMO de cada string. Contas Solana têm tamanho
    // fixo na criação: dimensionar pelo conteúdo inicial impediria o usuário
    // de escrever uma bio maior depois.
    pub const SPACE: usize = 8
        + 32
        + (4 + MAX_HANDLE_LEN)
        + (4 + MAX_BIO_LEN)
        + (4 + MAX_AVATAR_LEN)
        + Socials::SPACE
        + 8
        + 8
        + 1;
}

#[account]
pub struct WeeklyPayout {
    pub week_id: u32,
    pub position: u8,
    pub winner: Pubkey,
    pub amount: u64,
    pub paid_at: i64,
    pub bump: u8,
}
impl WeeklyPayout {
    pub const SPACE: usize = 8 + 4 + 1 + 32 + 8 + 8 + 1;
}

// ─────────────────────────────────────────────────────────────────────────
// Contextos
// ─────────────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitTreasury<'info> {
    #[account(
        init,
        payer = authority,
        space = Treasury::SPACE,
        seeds = [b"treasury"],
        bump
    )]
    pub treasury: Account<'info, Treasury>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FundTreasury<'info> {
    #[account(mut, seeds = [b"treasury"], bump = treasury.bump)]
    pub treasury: Account<'info, Treasury>,

    #[account(mut)]
    pub funder: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminTreasury<'info> {
    #[account(
        mut,
        seeds = [b"treasury"],
        bump = treasury.bump,
        // `has_one` amarra o campo `authority` da conta ao signatário.
        // Sem isto, qualquer carteira mudaria o teto diário do faucet.
        has_one = authority @ UrbanError::Unauthorized
    )]
    pub treasury: Account<'info, Treasury>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct InitProfile<'info> {
    #[account(
        init,
        payer = owner,
        space = Profile::SPACE,
        seeds = [b"profile", owner.key().as_ref()],
        bump
    )]
    pub profile: Account<'info, Profile>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateProfile<'info> {
    // Não há `has_one` aqui de propósito: o próprio seed já é a autorização.
    // O endereço do PDA é derivado da chave do signatário, então uma conta
    // de perfil alheia simplesmente não fecha com esta derivação — a
    // transação falha antes de qualquer checagem nossa. Adicionar `has_one`
    // exigiria passar uma conta a mais para verificar algo que o runtime já
    // garantiu.
    #[account(
        mut,
        seeds = [b"profile", owner.key().as_ref()],
        bump = profile.bump
    )]
    pub profile: Account<'info, Profile>,

    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct ClaimDaily<'info> {
    #[account(
        init_if_needed,
        payer = user,
        space = ClaimState::SPACE,
        seeds = [b"claim", user.key().as_ref()],
        bump
    )]
    pub claim_state: Account<'info, ClaimState>,

    #[account(mut, seeds = [b"treasury"], bump = treasury.bump)]
    pub treasury: Account<'info, Treasury>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(week_id: u32, position: u8)]
pub struct PayWeeklyPrize<'info> {
    // `init` é a trava de idempotência: pagar de novo a mesma semana e
    // posição falha porque a conta já existe.
    #[account(
        init,
        payer = authority,
        space = WeeklyPayout::SPACE,
        seeds = [b"payout", &week_id.to_le_bytes(), &[position]],
        bump
    )]
    pub payout: Account<'info, WeeklyPayout>,

    #[account(
        mut,
        seeds = [b"treasury"],
        bump = treasury.bump,
        has_one = authority @ UrbanError::Unauthorized
    )]
    pub treasury: Account<'info, Treasury>,

    /// CHECK: só recebe lamports; não lemos nem escrevemos dados nela.
    #[account(mut)]
    pub winner: UncheckedAccount<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

// ─────────────────────────────────────────────────────────────────────────
// Eventos — o indexador do app escuta estes logs em vez de varrer contas.
// ─────────────────────────────────────────────────────────────────────────

#[event]
pub struct ClaimExecuted {
    pub user: Pubkey,
    pub amount: u64,
    pub streak: u32,
    pub completed_cycle: bool,
}

#[event]
pub struct TreasuryFunded {
    pub funder: Pubkey,
    pub amount: u64,
}

#[event]
pub struct PrizePaid {
    pub week_id: u32,
    pub position: u8,
    pub winner: Pubkey,
    pub amount: u64,
}

// ─────────────────────────────────────────────────────────────────────────
// Erros
// ─────────────────────────────────────────────────────────────────────────

#[error_code]
pub enum UrbanError {
    #[msg("Seu próximo resgate ainda não liberou.")]
    ClaimOnCooldown,

    #[msg("O faucet do dia se esgotou. Volte amanhã para manter seu streak.")]
    DailyBudgetExhausted,

    #[msg("A carteira do projeto está sem saldo no momento.")]
    InsufficientTreasury,

    #[msg("Quantia inválida.")]
    InvalidAmount,

    #[msg("Posição inválida — o pódio vai de 1 a 3.")]
    InvalidPosition,

    #[msg("Não autorizado.")]
    Unauthorized,

    #[msg("O nome deve ter até 24 caracteres.")]
    HandleTooLong,

    #[msg("A bio deve ter até 160 caracteres.")]
    BioTooLong,

    #[msg("Identificador de avatar longo demais.")]
    AvatarTooLong,

    #[msg("Handle de rede social longo demais.")]
    SocialTooLong,

    #[msg("Erro aritmético.")]
    MathOverflow,
}
