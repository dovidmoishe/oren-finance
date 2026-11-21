import { Inject, Injectable } from '@nestjs/common';
import { Connection } from '@solana/web3.js';
import { APP_ENV } from '../config/constants';
import type { AppEnv } from '../config/env.schema';

@Injectable()
export class AtaRentSponsorRpc {
  constructor(@Inject(APP_ENV) private readonly env: AppEnv) {}

  connection(signal: AbortSignal): Connection {
    const network =
      this.env.SOLANA_NETWORK === 'devnet' ? 'solana-devnet' : 'solana-mainnet';
    return new Connection(
      `https://${network}.g.alchemy.com/v2/${this.env.ALCHEMY_API_KEY}`,
      {
        commitment: 'confirmed',
        disableRetryOnRateLimit: true,
        fetch: (
          input: Parameters<typeof fetch>[0],
          init?: Parameters<typeof fetch>[1],
        ) => fetch(input, { ...init, signal }),
      },
    );
  }
}
