mod common;

use common::{TestContext, INITIAL_MINT_AMOUNT, LOCK_AMOUNT};

#[test]
fn test_withdraw_rejects_before_unlock_time() {
    let mut ctx = TestContext::new();
    let unlock_time = ctx.future_unlock_time(3_600);

    ctx.send_lock_tokens(LOCK_AMOUNT, unlock_time)
        .expect("lock_tokens should succeed");

    let result = ctx.send_withdraw_tokens();
    assert!(result.is_err(), "withdraw should fail while tokens are locked");
    assert_eq!(ctx.vault_balance(), LOCK_AMOUNT);
    assert_eq!(
        ctx.user_token_balance(),
        INITIAL_MINT_AMOUNT - LOCK_AMOUNT
    );
}

#[test]
fn test_withdraw_returns_tokens_after_unlock_time() {
    let mut ctx = TestContext::new();
    let unlock_time = ctx.future_unlock_time(3_600);

    ctx.send_lock_tokens(LOCK_AMOUNT, unlock_time)
        .expect("lock_tokens should succeed");

    ctx.warp_past_unlock(unlock_time);

    ctx.send_withdraw_tokens()
        .expect("withdraw should succeed after unlock time");

    assert_eq!(ctx.user_token_balance(), INITIAL_MINT_AMOUNT);
    assert_eq!(ctx.vault_balance(), 0);
}
