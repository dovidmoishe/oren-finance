import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrivyWalletAuth } from '../../auth/privy-wallet-auth';
import {
  accessDecision,
  isMachineToken,
  type ReportPermission,
} from './growth-access';
import { tokenHash } from './growth-privacy';
import { GrowthRepository } from './growth.repository';

@Injectable()
export class GrowthAccessService {
  constructor(
    private readonly repository: GrowthRepository,
    private readonly auth: PrivyWalletAuth,
  ) {}

  async authenticate(
    authorization: string | undefined,
    required: ReportPermission,
  ): Promise<void> {
    const token = authorization?.replace(/^Bearer\s+/i, '').trim() ?? '';
    if (!token) throw new UnauthorizedException();
    const rows = isMachineToken(token)
      ? await this.repository.grantsFor({ tokenHash: tokenHash(token) })
      : await this.repository.grantsFor({
          privyUserId: await this.privyUser(authorization),
        });
    const now = new Date();
    const matching = rows.filter((grant) => grant.permission === required);
    const decisions = (matching.length > 0 ? matching : rows).map((grant) =>
      accessDecision(grant, now, required),
    );
    if (decisions.some((decision) => decision.ok)) return;
    const denied = decisions.find((decision) => !decision.ok);
    if (!denied || denied.reason === 'missing') throw new ForbiddenException();
    throw new ForbiddenException({ reason: denied.reason });
  }

  private async privyUser(authorization: string | undefined): Promise<string> {
    try {
      return await this.auth.requireMcpUser(authorization);
    } catch {
      throw new UnauthorizedException();
    }
  }
}
