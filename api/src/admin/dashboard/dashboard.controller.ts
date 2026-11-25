import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { AdminAuthService } from '../auth/admin-auth.service';
import { ADMIN_COOKIE, ADMIN_HEADER, readCookie } from '../auth/admin-cookie';
import { AdminNoStoreInterceptor } from '../auth/admin-no-store.interceptor';
import { assertTimezone, dayBounds, eachDay } from '../reporting/growth-time';
import { requiredDay } from '../reporting/reporting-auth.guard';
import { DashboardRepository } from './dashboard.repository';

/** Session-only operations. Machine report credentials never authorize these routes. */
@Controller('admin/dashboard')
@UseInterceptors(AdminNoStoreInterceptor)
export class DashboardController {
  constructor(
    private readonly auth: AdminAuthService,
    private readonly repository: DashboardRepository,
  ) {}

  @Get('activity')
  async activity(
    @Headers('cookie') cookie: string | undefined,
    @Headers(ADMIN_HEADER) marker: string | undefined,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('timezone') timezone?: string,
  ) {
    requireMarker(marker);
    await this.auth.reportActor(readCookie(cookie, ADMIN_COOKIE));
    const { start, end } = activityRange(from, to, timezone);
    return this.repository.activity(start, end);
  }

  @Get('users')
  async users(
    @Headers('cookie') cookie: string | undefined,
    @Headers(ADMIN_HEADER) marker: string | undefined,
    @Query('page') page?: string,
  ) {
    await this.requireDashboard(cookie, marker);
    return this.repository.users(pageNumber(page));
  }

  @Get('connections')
  async connections(
    @Headers('cookie') cookie: string | undefined,
    @Headers(ADMIN_HEADER) marker: string | undefined,
    @Query('page') page?: string,
  ) {
    await this.requireDashboard(cookie, marker);
    return this.repository.connections(pageNumber(page));
  }

  @Get('trades')
  async trades(
    @Headers('cookie') cookie: string | undefined,
    @Headers(ADMIN_HEADER) marker: string | undefined,
    @Query('page') page?: string,
  ) {
    await this.requireDashboard(cookie, marker);
    return this.repository.trades(pageNumber(page));
  }

  @Get('audit')
  async audit(
    @Headers('cookie') cookie: string | undefined,
    @Headers(ADMIN_HEADER) marker: string | undefined,
    @Query('page') page?: string,
  ) {
    requireMarker(marker);
    await this.auth.masterActor(readCookie(cookie, ADMIN_COOKIE));
    return this.repository.audit(pageNumber(page));
  }

  private async requireDashboard(
    cookie: string | undefined,
    marker: string | undefined,
  ) {
    requireMarker(marker);
    await this.auth.dashboardActor(readCookie(cookie, ADMIN_COOKIE));
  }
}

function requireMarker(marker: string | undefined) {
  if (marker !== '1')
    throw new BadRequestException('Admin request header required');
}

export function pageNumber(value?: string): number {
  if (value === undefined) return 1;
  if (!/^[1-9]\d{0,4}$/.test(value))
    throw new BadRequestException('Invalid page');
  return Number(value);
}

function activityRange(from?: string, to?: string, timezone?: string) {
  const first = requiredDay(from, 'from');
  const last = requiredDay(to, 'to');
  try {
    const zone = assertTimezone(timezone);
    const days = eachDay(first, last);
    if (days[0] !== first || days.at(-1) !== last) throw new Error();
    return {
      start: dayBounds(first, zone).start,
      end: dayBounds(last, zone).end,
    };
  } catch {
    throw new BadRequestException('Invalid date range or timezone');
  }
}
