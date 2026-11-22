import { Inject, Injectable, Logger } from '@nestjs/common';
import { PublicKey, Transaction } from '@solana/web3.js';
import {
  ACCOUNT_SIZE,
  ExtensionType,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  getAccountLen,
  getAccountTypeOfMintType,
  getExtensionTypes,
  unpackMint,
} from '@solana/spl-token';
import bs58 from 'bs58';
import { setTimeout as delay } from 'node:timers/promises';
import type { Quote } from '../../types/quote';
import { APP_ENV, USDC_MINT } from '../config/constants';
import type { AppEnv } from '../config/env.schema';
import { assertFinancialExecutionEnabled } from '../config/deployment';
import { rawIn } from './swap-terms';
import { ataRentSwapCompatible } from './ata-rent-sponsor-eligibility';
import { AtaRentSponsorRepository } from './ata-rent-sponsor.repository';
import { AtaRentSponsorSigner } from './ata-rent-sponsor.signer';
import { AtaRentSponsorRpc } from './ata-rent-sponsor.rpc';

/** Internal, server-supplied context; never deserialized from a prepare request. */
export interface AtaRentReviewContext {
  flow: 'user_reviewed' | 'agent' | 'mcp' | 'delegated' | 'limit_order';
  userId: string;
}
export type AtaRentSkipReason =
  | 'disabled'
  | 'unavailable'
  | 'ineligible_flow'
  | 'sell'
  | 'ineligible_asset'
  | 'incompatible_swap'
  | 'invalid_amount'
  | 'below_min_trade'
  | 'insufficient_usdc'
  | 'already_exists'
  | 'unsupported_token_program'
  | 'low_balance'
  | 'previous_attempt'
  | 'per_user_cap'
  | 'daily_budget';

@Injectable()
export class AtaRentSponsorService {
  private readonly logger = new Logger(AtaRentSponsorService.name);
  private lastLowBalanceWarning = -Infinity;

  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly repository: AtaRentSponsorRepository,
    private readonly signer: AtaRentSponsorSigner,
    private readonly rpc: AtaRentSponsorRpc,
  ) {
    if (env.ATA_RENT_SPONSORSHIP && !env.ATA_RENT_CONFIG)
      this.logger.warn({
        event: 'ata_rent_unavailable',
        reason: 'invalid_configuration',
      });
  }

  get enabled(): boolean {
    return !!(this.env.ATA_RENT_SPONSORSHIP && this.env.ATA_RENT_CONFIG);
  }

  /** Never rejects a prepare or exposes provider errors/addresses in logs. */
  async cover(
    quote: Quote,
    wallet: string,
    context?: AtaRentReviewContext,
    swapTransaction?: string,
  ): Promise<boolean> {
    const skip = (reason: AtaRentSkipReason) => {
      this.logger.debug({
        event: 'ata_rent_skipped',
        reason,
        userId: context?.userId,
      });
      return false;
    };
    if (!this.env.ATA_RENT_SPONSORSHIP) return skip('disabled');
    const config = this.env.ATA_RENT_CONFIG;
    if (!config) return skip('unavailable');
    if (context?.flow !== 'user_reviewed' || !context.userId)
      return skip('ineligible_flow');
    if (quote.side !== 'buy') return skip('sell');
    if (
      quote.inputMint !== USDC_MINT ||
      quote.outputMint !== quote.variant.mint ||
      !quote.variant.tradable ||
      !quote.assetId ||
      quote.assetId === 'unknown'
    )
      return skip('ineligible_asset');
    const raw = rawIn(quote);
    if (!raw || !/^\d+$/.test(raw) || BigInt(raw) <= 0n)
      return skip('invalid_amount');
    const amount = BigInt(raw);
    if (amount < config.minTradeRaw) return skip('below_min_trade');
    if (!swapTransaction || !ataRentSwapCompatible(swapTransaction))
      return skip('incompatible_swap');

    const controller = new AbortController();
    const { signal } = controller;
    let reservationId: string | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Aborting fetch AND checking before each mutation prevents a slow read/sign from
    // submitting a transaction after prepare has already fallen back.
    const work = async (): Promise<boolean> => {
      try {
        assertFinancialExecutionEnabled();
        const connection = this.rpc.connection(signal);
        const owner = new PublicKey(wallet);
        const mint = new PublicKey(quote.outputMint);
        const payer = new PublicKey(config.address);
        const info = await connection.getAccountInfo(mint, 'confirmed');
        signal.throwIfAborted();
        const programAddress = info?.owner.toBase58();
        const program =
          programAddress === TOKEN_PROGRAM_ID.toBase58()
            ? TOKEN_PROGRAM_ID
            : programAddress === TOKEN_2022_PROGRAM_ID.toBase58()
              ? TOKEN_2022_PROGRAM_ID
              : undefined;
        if (!info || !program) return skip('unsupported_token_program');
        const ata = getAssociatedTokenAddressSync(mint, owner, false, program);
        if (await connection.getAccountInfo(ata, 'confirmed'))
          return skip('already_exists');
        const usdcAta = getAssociatedTokenAddressSync(
          new PublicKey(USDC_MINT),
          owner,
          false,
          TOKEN_PROGRAM_ID,
        );
        const balance = await connection.getTokenAccountBalance(
          usdcAta,
          'confirmed',
        );
        if (
          !/^\d+$/.test(balance.value.amount) ||
          BigInt(balance.value.amount) < amount
        )
          return skip('insufficient_usdc');
        const mintState = unpackMint(mint, info, program);
        if (!mintState.isInitialized) return skip('ineligible_asset');
        // Token-2022 ATAs always include ImmutableOwner in addition to mint-required extensions.
        const size =
          program === TOKEN_PROGRAM_ID
            ? ACCOUNT_SIZE
            : getAccountLen([
                ExtensionType.ImmutableOwner,
                ...getExtensionTypes(mintState.tlvData).map(
                  getAccountTypeOfMintType,
                ),
              ]);
        const rent = await connection.getMinimumBalanceForRentExemption(
          size,
          'confirmed',
        );
        const blockhash = await connection.getLatestBlockhash('confirmed');
        const tx = new Transaction({
          feePayer: payer,
          recentBlockhash: blockhash.blockhash,
        }).add(
          createAssociatedTokenAccountIdempotentInstruction(
            payer,
            ata,
            owner,
            mint,
            program,
          ),
        );
        const fee = (
          await connection.getFeeForMessage(tx.compileMessage(), 'confirmed')
        ).value;
        if (
          fee === null ||
          !Number.isSafeInteger(rent) ||
          rent < 0 ||
          !Number.isSafeInteger(fee) ||
          fee < 0
        )
          throw new Error('Unavailable setup cost');
        const lamports = BigInt(rent) + BigInt(fee);
        const sponsorBalance = BigInt(
          await connection.getBalance(payer, 'confirmed'),
        );
        if (sponsorBalance < config.minBalanceLamports + lamports) {
          if (Date.now() - this.lastLowBalanceWarning >= 60_000) {
            this.lastLowBalanceWarning = Date.now();
            this.logger.warn({
              event: 'ata_rent_low_balance',
              reason: 'low_balance',
            });
          }
          return skip('low_balance');
        }
        signal.throwIfAborted();
        const reservation = await this.repository.reserve({
          userId: context.userId,
          wallet,
          mint: quote.outputMint,
          lamports,
          perUserCap: config.perUserCap,
          dailyBudgetLamports: config.dailyBudgetLamports,
        });
        if ('reason' in reservation) return skip(reservation.reason);
        reservationId = reservation.row.id;
        signal.throwIfAborted();
        const unsigned = tx
          .serialize({ requireAllSignatures: false })
          .toString('base64');
        const signed = await this.signer.sign(unsigned, reservationId, signal);
        signal.throwIfAborted();
        const signedTx = Transaction.from(Buffer.from(signed, 'base64'));
        if (
          !signedTx.serializeMessage().equals(tx.serializeMessage()) ||
          !signedTx.verifySignatures() ||
          signedTx.signatures.length !== 1 ||
          !signedTx.signature
        )
          throw new Error('Invalid setup signature');
        const signature = bs58.encode(signedTx.signature);
        // Persist BEFORE broadcast, so a crash/lost RPC response always has a recovery signature.
        await this.repository.signature(reservationId, signature);
        signal.throwIfAborted();
        assertFinancialExecutionEnabled();
        await connection.sendRawTransaction(signedTx.serialize(), {
          skipPreflight: false,
          maxRetries: 0,
        });
        while (true) {
          signal.throwIfAborted();
          const status = (await connection.getSignatureStatuses([signature]))
            .value[0];
          if (status?.err) throw new Error('Setup rejected');
          if (
            status?.confirmationStatus === 'confirmed' ||
            status?.confirmationStatus === 'finalized' ||
            (await connection.getAccountInfo(ata, 'confirmed'))
          )
            break;
          await delay(200, undefined, { signal });
        }
        signal.throwIfAborted();
        await this.repository.finish(reservationId, 'sponsored');
        this.logger.log({
          event: 'ata_rent_sponsored',
          userId: context.userId,
          lamports: lamports.toString(),
        });
        return true;
      } catch {
        if (reservationId) {
          // Cleanup can finish after the bounded response; a stale row is never reusable.
          await this.repository
            .finish(
              reservationId,
              'failed',
              signal.aborted ? 'timeout' : 'sponsor_failure',
            )
            .catch(() => undefined);
        }
        throw new Error('ATA setup failed');
      }
    };
    try {
      return await Promise.race([
        work(),
        new Promise<boolean>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error('ATA setup timeout'));
          }, config.timeoutMs);
        }),
      ]);
    } catch {
      this.logger.warn({
        event: 'ata_rent_failed',
        reason: signal.aborted ? 'timeout' : 'sponsor_failure',
        userId: context.userId,
      });
      return false;
    } finally {
      if (timer) clearTimeout(timer);
      controller.abort();
    }
  }
}
