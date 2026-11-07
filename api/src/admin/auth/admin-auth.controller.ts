import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { APP_ENV } from '../../config/constants';
import type { AppEnv } from '../../config/env.schema';
import { AdminAuthService } from './admin-auth.service';
import {
  ADMIN_COOKIE,
  ADMIN_HEADER,
  CSRF_HEADER,
  clearSessionCookie,
  readCookie,
  sessionCookie,
} from './admin-cookie';

@Controller('admin/auth')
export class AdminAuthController {
  constructor(
    private readonly auth: AdminAuthService,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  @Post('session')
  @HttpCode(200)
  async login(
    @Body() body: { email?: string; password?: string },
    @Headers(ADMIN_HEADER) marker: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.requireMarker(marker);
    const result = await this.auth.login({
      email: body?.email ?? '',
      password: body?.password ?? '',
      ip: request.ip,
    });
    response.setHeader(
      'Set-Cookie',
      sessionCookie(result.sessionId, result.maxAgeSeconds, this.secure()),
    );
    return {
      mustChangePassword: result.mustChangePassword,
      csrfToken: result.csrfToken,
    };
  }

  @Post('session/logout')
  @HttpCode(204)
  async logout(
    @Headers(ADMIN_HEADER) marker: string | undefined,
    @Headers(CSRF_HEADER) csrf: string | undefined,
    @Headers('cookie') cookie: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.requireMarker(marker);
    await this.auth.logout(readCookie(cookie, ADMIN_COOKIE), csrf);
    response.setHeader('Set-Cookie', clearSessionCookie(this.secure()));
  }

  @Post('password')
  @HttpCode(204)
  async password(
    @Body() body: { currentPassword?: string; nextPassword?: string },
    @Headers(ADMIN_HEADER) marker: string | undefined,
    @Headers(CSRF_HEADER) csrf: string | undefined,
    @Headers('cookie') cookie: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.requireMarker(marker);
    await this.auth.changePassword({
      sessionId: readCookie(cookie, ADMIN_COOKIE),
      csrfToken: csrf,
      currentPassword: body?.currentPassword ?? '',
      nextPassword: body?.nextPassword ?? '',
    });
    response.setHeader('Set-Cookie', clearSessionCookie(this.secure()));
  }

  @Get('accounts')
  accounts(
    @Headers(ADMIN_HEADER) marker: string | undefined,
    @Headers(CSRF_HEADER) csrf: string | undefined,
    @Headers('cookie') cookie: string | undefined,
  ) {
    this.requireMarker(marker);
    return this.auth.list({
      sessionId: readCookie(cookie, ADMIN_COOKIE),
      csrfToken: csrf,
    });
  }

  @Post('accounts')
  invite(
    @Body() body: { email?: string; permissions?: string[] },
    @Headers(ADMIN_HEADER) marker: string | undefined,
    @Headers(CSRF_HEADER) csrf: string | undefined,
    @Headers('cookie') cookie: string | undefined,
  ) {
    this.requireMarker(marker);
    return this.auth.invite({
      sessionId: readCookie(cookie, ADMIN_COOKIE),
      csrfToken: csrf,
      email: body?.email ?? '',
      permissions: body?.permissions ?? [],
    });
  }

  @Post('accounts/:id/revoke')
  @HttpCode(204)
  revoke(
    @Param('id') id: string,
    @Headers(ADMIN_HEADER) marker: string | undefined,
    @Headers(CSRF_HEADER) csrf: string | undefined,
    @Headers('cookie') cookie: string | undefined,
  ) {
    this.requireMarker(marker);
    return this.auth.revoke({
      sessionId: readCookie(cookie, ADMIN_COOKIE),
      csrfToken: csrf,
      accountId: id,
    });
  }

  @Post('accounts/:id/temporary-password')
  rotate(
    @Param('id') id: string,
    @Headers(ADMIN_HEADER) marker: string | undefined,
    @Headers(CSRF_HEADER) csrf: string | undefined,
    @Headers('cookie') cookie: string | undefined,
  ) {
    this.requireMarker(marker);
    return this.auth.rotateTemporary({
      sessionId: readCookie(cookie, ADMIN_COOKIE),
      csrfToken: csrf,
      accountId: id,
    });
  }

  private requireMarker(marker: string | undefined) {
    if (marker !== '1') throw new UnauthorizedException();
  }

  private secure(): boolean {
    return this.env.DEPLOYMENT_ENV !== 'development';
  }
}
