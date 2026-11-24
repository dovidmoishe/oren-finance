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
import { DashboardRepository } from './dashboard.repository';

/** Session-only operations. Machine report credentials never authorize these routes. */
@Controller('admin/dashboard')
@UseInterceptors(AdminNoStoreInterceptor)
export class DashboardController {
  constructor(
    private readonly auth: AdminAuthService,
    private readonly repository: DashboardRepository,
  ) {}

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
