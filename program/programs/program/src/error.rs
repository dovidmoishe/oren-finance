use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("The lock period has not expired yet.")]
    TokenStillLocked,
}
