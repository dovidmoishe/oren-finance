import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import {
  accessDecision,
  browserReportRequest,
  isMachineToken,
} from './growth-access';
import { tokenHash } from './growth-privacy';
import { GrowthRepository } from './growth.repository';

@Injectable()
export class GrowthAccessService {
  constructor(private readonly repository: GrowthRepository) {}

  async authenticate(
    authorization: string | undefined,
    origin: string | undefined,
  ): Promise<void> {
    if (browserReportRequest(origin)) throw new ForbiddenException();
    const token = /^Bearer\s+(\S+)$/i.exec(authorization ?? '')?.[1];
    if (!token || !isMachineToken(token)) throw new UnauthorizedException();
    const rows = await this.repository.grantsFor(tokenHash(token));
    const now = new Date();
    const decisions = rows.map((grant) => accessDecision(grant, now));
    if (decisions.some((decision) => decision.ok)) return;
    const denied = decisions.find((decision) => !decision.ok);
    if (!denied || denied.reason === 'missing') throw new ForbiddenException();
    throw new ForbiddenException({ reason: denied.reason });
  }
}
