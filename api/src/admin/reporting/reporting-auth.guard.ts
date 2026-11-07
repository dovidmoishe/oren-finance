import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ReportPermission } from './growth-access';
import { GrowthAccessService } from './growth-access.service';

export const REPORT_PERMISSION = 'reportPermission';
export const RequiresReportPermission = (permission: ReportPermission) =>
  SetMetadata(REPORT_PERMISSION, permission);

@Injectable()
export class ReportingAuthGuard implements CanActivate {
  constructor(
    private readonly access: GrowthAccessService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required =
      this.reflector.get<ReportPermission | undefined>(
        REPORT_PERMISSION,
        context.getHandler(),
      ) ?? 'marketing.read';
    const request = context
      .switchToHttp()
      .getRequest<{ headers: { authorization?: string } }>();
    await this.access.authenticate(request.headers.authorization, required);
    return true;
  }
}

export function requiredDay(value: string | undefined, name: string): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException(`${name} must be YYYY-MM-DD`);
  }
  return value;
}
