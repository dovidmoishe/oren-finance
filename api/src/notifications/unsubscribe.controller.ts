import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { NotificationDelivery } from './delivery';

@Controller('notifications/unsubscribe')
export class NotificationUnsubscribeController {
  constructor(private readonly delivery: NotificationDelivery) {}

  @Get(':token')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @Header(
    'Content-Security-Policy',
    "default-src 'none'; form-action 'self'; frame-ancestors 'none'",
  )
  async confirm(@Param('token') token: string) {
    const kind = await this.delivery.subscription(token, false);
    if (!kind) throw new NotFoundException();
    const label = kind === 'brief-email' ? 'Morning Brief' : 'price alert';
    return `<!doctype html><html lang="en"><title>Unsubscribe from Oren</title><main><h1>Stop ${label} emails?</h1><form method="post"><button>Unsubscribe</button></form></main></html>`;
  }

  @Post(':token')
  @Header('Cache-Control', 'no-store')
  async stop(@Param('token') token: string) {
    if (!(await this.delivery.subscription(token, true)))
      throw new NotFoundException();
    return { unsubscribed: true };
  }
}
