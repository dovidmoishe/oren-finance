import { ForbiddenException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { PrivyClient } from '@privy-io/node';

/** Verifies both the session and the wallet's current association with that user. */
export class PrivyWalletAuth {
  private readonly client?: PrivyClient;

  constructor(appId?: string, appSecret?: string) {
    if (appId && appSecret) this.client = new PrivyClient({ appId, appSecret });
  }

  async requireWallet(authorization: string | undefined, wallet: string): Promise<string> {
    if (!this.client) throw new ServiceUnavailableException('Authentication is not configured');
    const match = /^Bearer\s+(\S+)$/i.exec(authorization ?? '');
    if (!match) throw new UnauthorizedException('Authentication required');

    let userId: string;
    try {
      const claims = await this.client.utils().auth().verifyAccessToken(match[1]);
      userId = claims.user_id;
    } catch {
      throw new UnauthorizedException('Invalid or expired session');
    }

    let user: Awaited<ReturnType<ReturnType<PrivyClient['users']>['_get']>>;
    try {
      user = await this.client.users()._get(userId);
    } catch {
      throw new ServiceUnavailableException('Unable to verify wallet ownership');
    }
    if (!user.linked_accounts.some((account) =>
      account.type === 'wallet' && account.chain_type === 'solana' && account.address === wallet,
    )) throw new ForbiddenException('Wallet is not linked to this account');
    return userId;
  }
}
