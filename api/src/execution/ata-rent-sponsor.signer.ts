import { Inject, Injectable } from '@nestjs/common';
import { APP_ENV } from '../config/constants';
import type { AppEnv } from '../config/env.schema';

/** Only the sponsor service supplies these server-built ATA transaction bytes. */
export abstract class AtaRentSponsorSigner {
  abstract sign(
    transaction: string,
    reservationId: string,
    signal: AbortSignal,
  ): Promise<string>;
}

@Injectable()
export class PrivyAtaRentSponsorSigner extends AtaRentSponsorSigner {
  constructor(@Inject(APP_ENV) private readonly env: AppEnv) {
    super();
  }

  async sign(
    transaction: string,
    reservationId: string,
    signal: AbortSignal,
  ): Promise<string> {
    const config = this.env.ATA_RENT_CONFIG;
    if (!this.env.ATA_RENT_SPONSORSHIP || config?.signer !== 'privy')
      throw new Error('ATA sponsor unavailable');
    signal.throwIfAborted();
    const { PrivyClient } = await import('@privy-io/node');
    signal.throwIfAborted();
    const client = new PrivyClient({
      appId: this.env.PRIVY_APP_ID!,
      appSecret: this.env.PRIVY_APP_SECRET!,
      maxRetries: 0,
      timeout: config.timeoutMs,
      fetch: (input, init) => fetch(input, { ...init, signal }),
    });
    const wallet = await client.wallets().get(config.walletId);
    if (wallet.chain_type !== 'solana' || wallet.address !== config.address)
      throw new Error('ATA sponsor wallet mismatch');
    signal.throwIfAborted();
    const result = await client
      .wallets()
      .solana()
      .signTransaction(config.walletId, {
        transaction,
        idempotency_key: reservationId,
        request_expiry: Date.now() + config.timeoutMs,
      });
    return result.signed_transaction;
  }
}
