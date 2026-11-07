import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { GrowthAccessService } from './growth-access.service';
import { isMachineToken } from './growth-access';
import { AdminAuthService } from '../auth/admin-auth.service';
import { ADMIN_COOKIE, readCookie } from '../auth/admin-cookie';

@Injectable()
export class ReportingAuthGuard implements CanActivate {
  constructor(
    private readonly access: GrowthAccessService,
    private readonly admins: AdminAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers: { authorization?: string; origin?: string; cookie?: string };
    }>();
    const token =
      request.headers.authorization?.replace(/^Bearer\s+/i, '').trim() ?? '';
    if (token) {
      if (!isMachineToken(token)) throw new UnauthorizedException();
      await this.access.authenticate(
        request.headers.authorization,
        request.headers.origin,
      );
      return true;
    }
    await this.admins.reportActor(
      readCookie(request.headers.cookie, ADMIN_COOKIE),
    );
    return true;
  }
}

export function requiredDay(value: string | undefined, name: string): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException(`${name} must be YYYY-MM-DD`);
  }
  return value;
}
