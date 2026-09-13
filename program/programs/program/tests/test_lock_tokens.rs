mod common;

use common::{TestContext, INITIAL_MINT_AMOUNT, LOCK_AMOUNT};
use solana_signer::Signer;

#[test]
fn test_lock_tokens_transfers_to_vault_and_initializes_lockbox() {
    let mut ctx = TestContext::new();
    assert_eq!(ctx.user_token_balance(), INITIAL_MINT_AMOUNT);

    let unlock_time = ctx.future_unlock_time(3_600);
    ctx.send_lock_tokens(LOCK_AMOUNT, unlock_time)
        .expect("lock_tokens should succeed");

    let lockbox = ctx.lockbox_state();
    assert_eq!(lockbox.owner, ctx.user.pubkey());
    assert_eq!(lockbox.token_mint, ctx.mint);
    assert_eq!(lockbox.total_deposited, LOCK_AMOUNT);
    assert_eq!(lockbox.unlock_time, unlock_time);

    assert_eq!(
        ctx.user_token_balance(),
        INITIAL_MINT_AMOUNT - LOCK_AMOUNT
    );
    assert_eq!(ctx.vault_balance(), LOCK_AMOUNT);
}
