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
    const label = emailLabel(kind);
    return unsubscribePage(
      `Stop ${label} emails?`,
      `<p>This stops ${label} emails from Oren. You can turn them back on in the app.</p><form method="post"><button>Unsubscribe</button></form>`,
    );
  }

  @Post(':token')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @Header(
    'Content-Security-Policy',
    "default-src 'none'; frame-ancestors 'none'",
  )
  async stop(@Param('token') token: string) {
    const kind = await this.delivery.subscription(token, true);
    if (!kind) throw new NotFoundException();
    const label = emailLabel(kind);
    return unsubscribePage(
      'You are unsubscribed',
      `<p>Oren will stop sending ${label} emails.</p>`,
    );
  }
}

function emailLabel(kind: 'brief-email' | 'alert-email') {
  return kind === 'brief-email' ? 'Morning Brief' : 'price alert';
}

function unsubscribePage(title: string, body: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head><body><main><h1>${title}</h1>${body}</main></body></html>`;
}
