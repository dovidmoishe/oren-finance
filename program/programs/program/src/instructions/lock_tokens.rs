use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface, TransferChecked, transfer_checked};
use crate::state::LockBoxState;

#[derive(Accounts)]
pub struct LockTokens<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    pub token_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        token::mint = token_mint,
        token::authority = user,
    )]
    pub user_token_account: InterfaceAccount<'info, TokenAccount>;

    #[account(
        init,
        payer = user,
        space = 8 + LockBoxState::INIT_SPACE,
        seeds = [b"lockbox", user.key().as_ref(), token_mint.key().as_ref()],
        bump
    )]
    pub lockbox: Account<'info, LockBoxState>,

    #[account(
        init,
        payer = user,
        token::mint = token_mint,
        token::authority = lockbox, 
    )]
    pub token_vault: InterfaceAccount<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<LockTokens>, amount: u64, unlock_time: i64) -> Result<()> {
    let lockbox = &mut ctx.accounts.lockbox;
    lockbox.owner = ctx.accounts.user.key();
    lockbox.token_mint = ctx.accounts.token_mint.key();
    lockbox.unlock_time = unlock_time;
    lockbox.bump = ctx.bumps.lockbox;

    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_accounts = TransferChecked {
        from: ctx.accounts.user_token_account.to_account_info(),
        mint: ctx.accounts.token_mint.to_account_info(),
        to: ctx.accounts.token_vault.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };
    
    let cpi_ctx = Context::new(cpi_program, cpi_accounts);
    transfer_checked(cpi_ctx, amount, ctx.accounts.token_mint.decimals)?;

    msg!("Successfully locked {} tokens until timestamp {}", amount, unlock_time);
    Ok(())
}
