use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::{instruction::Instruction, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    litesvm::LiteSVM,
    litesvm_token::{
        get_spl_account, CreateAssociatedTokenAccount, CreateMint, MintTo, TOKEN_ID,
    },
    spl_token_interface::state::Account as SplTokenAccount,
    solana_clock::Clock,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_native_token::LAMPORTS_PER_SOL,
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

pub const TOKEN_DECIMALS: u8 = 6;
pub const LOCK_AMOUNT: u64 = 1_000_000;
pub const INITIAL_MINT_AMOUNT: u64 = 10 * LOCK_AMOUNT;

pub fn setup_svm() -> LiteSVM {
    let program_id = program::id();
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!(concat!(
        env!("CARGO_TARGET_TMPDIR"),
        "/../deploy/program.so"
    ));
    svm.add_program(program_id, bytes).unwrap();
    svm
}

pub struct TestContext {
    pub svm: LiteSVM,
    pub program_id: Pubkey,
    pub user: Keypair,
    pub mint: Pubkey,
    pub user_token_account: Pubkey,
}

impl TestContext {
    pub fn new() -> Self {
        let program_id = program::id();
        let mut svm = setup_svm();
        let user = Keypair::new();
        svm.airdrop(&user.pubkey(), 10 * LAMPORTS_PER_SOL).unwrap();

        let mint: Pubkey = CreateMint::new(&mut svm, &user)
            .authority(&user.pubkey())
            .decimals(TOKEN_DECIMALS)
            .send()
            .unwrap()
            .into();

        let user_token_account: Pubkey =
            CreateAssociatedTokenAccount::new(&mut svm, &user, &mint)
                .owner(&user.pubkey())
                .send()
                .unwrap()
                .into();

        MintTo::new(
            &mut svm,
            &user,
            &mint,
            &user_token_account,
            INITIAL_MINT_AMOUNT,
        )
        .owner(&user)
        .send()
        .unwrap();

        Self {
            svm,
            program_id,
            user,
            mint,
            user_token_account,
        }
    }

    pub fn lockbox_pda(&self) -> (Pubkey, u8) {
        Pubkey::find_program_address(
            &[b"lockbox", self.user.pubkey().as_ref(), self.mint.as_ref()],
            &self.program_id,
        )
    }

    pub fn token_vault_pda(&self, lockbox: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(
            &[b"token_vault", lockbox.as_ref()],
            &self.program_id,
        )
    }

    pub fn send_lock_tokens(&mut self, amount: u64, unlock_time: i64) -> Result<(), String> {
        let (lockbox, _) = self.lockbox_pda();
        let (token_vault, _) = self.token_vault_pda(&lockbox);

        let instruction = Instruction::new_with_bytes(
            self.program_id,
            &program::instruction::LockTokens { amount, unlock_time }.data(),
            program::accounts::LockTokens {
                user: self.user.pubkey(),
                token_mint: self.mint,
                user_token_account: self.user_token_account,
                lockbox,
                token_vault,
                system_program: system_program::ID,
                token_program: TOKEN_ID.into(),
            }
            .to_account_metas(None),
        );

        self.send_tx(&[instruction])
    }

    pub fn send_top_up_vault(&mut self, amount: u64) -> Result<(), String> {
        let (lockbox, _) = self.lockbox_pda();
        let (token_vault, _) = self.token_vault_pda(&lockbox);

        let instruction = Instruction::new_with_bytes(
            self.program_id,
            &program::instruction::TopUpVault { amount }.data(),
            program::accounts::TopUpVault {
                user: self.user.pubkey(),
                token_mint: self.mint,
                user_token_account: self.user_token_account,
                lockbox,
                token_vault,
                token_program: TOKEN_ID.into(),
            }
            .to_account_metas(None),
        );

        self.send_tx(&[instruction])
    }

    pub fn send_withdraw_tokens(&mut self) -> Result<(), String> {
        let (lockbox, _) = self.lockbox_pda();
        let (token_vault, _) = self.token_vault_pda(&lockbox);

        let instruction = Instruction::new_with_bytes(
            self.program_id,
            &program::instruction::WithdrawTokens {}.data(),
            program::accounts::WithdrawTokens {
                user: self.user.pubkey(),
                token_mint: self.mint,
                user_token_account: self.user_token_account,
                lockbox,
                token_vault,
                token_program: TOKEN_ID.into(),
            }
            .to_account_metas(None),
        );

        self.send_tx(&[instruction])
    }

    fn send_tx(&mut self, instructions: &[Instruction]) -> Result<(), String> {
        let blockhash = self.svm.latest_blockhash();
        let msg = Message::new_with_blockhash(
            instructions,
            Some(&self.user.pubkey()),
            &blockhash,
        );
        let tx =
            VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&self.user]).unwrap();
            self.svm
            .send_transaction(tx)
            .map(|_| ()) // Discards the TransactionMetadata and returns () on success
            .map_err(|failure| format!("{failure:?}"))   
    }

    pub fn user_token_balance(&self) -> u64 {
        get_spl_account::<SplTokenAccount>(&self.svm, &self.user_token_account)
            .unwrap()
            .amount
    }

    pub fn vault_balance(&self) -> u64 {
        let (lockbox, _) = self.lockbox_pda();
        let (token_vault, _) = self.token_vault_pda(&lockbox);
        get_spl_account::<SplTokenAccount>(&self.svm, &token_vault)
            .unwrap()
            .amount
    }

    pub fn lockbox_state(&self) -> program::state::LockBoxState {
        let (lockbox, _) = self.lockbox_pda();
        let account = self.svm.get_account(&lockbox).unwrap();
        let mut data: &[u8] = &account.data;
        program::state::LockBoxState::try_deserialize(&mut data).unwrap()
    }

    pub fn warp_past_unlock(&mut self, unlock_time: i64) {
        let mut clock: Clock = self.svm.get_sysvar();
        clock.unix_timestamp = unlock_time + 1;
        self.svm.set_sysvar(&clock);
    }

    pub fn future_unlock_time(&self, offset_secs: i64) -> i64 {
        let clock: Clock = self.svm.get_sysvar();
        clock.unix_timestamp + offset_secs
    }
}
