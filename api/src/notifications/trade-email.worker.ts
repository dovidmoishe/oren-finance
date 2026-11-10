import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { AppEnv } from '../config/env.schema';
import { backgroundWorkersEnabled } from '../config/deployment';
import { APP_ENV } from '../config/constants';
import { Inject } from '@nestjs/common';
import { PrivyWalletAuth } from '../auth/privy-wallet-auth';
import { SenviokEmailService } from '../senviok/senviok.service';
import {
  TradeEmailRepository,
  type TradeReceiptJob,
} from './trade-email.repository';

@Injectable()
export class TradeEmailWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TradeEmailWorker.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly repository: TradeEmailRepository,
    private readonly auth: PrivyWalletAuth,
    private readonly emails: SenviokEmailService,
  ) {}

  onModuleInit() {
    if (!backgroundWorkersEnabled() || !this.emails.isConfigured) return;
    this.timer = setInterval(() => void this.tick(), 10_000);
    this.timer.unref();
    void this.tick();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (
      !backgroundWorkersEnabled() ||
      !this.emails.isConfigured ||
      this.running
    )
      return;
    this.running = true;
    try {
      const jobs = await this.repository.claimJobs();
      await Promise.all(jobs.map((job) => this.process(job)));
    } catch {
      this.logger.error('Trade receipt worker tick failed');
    } finally {
      this.running = false;
    }
  }

  private async process(job: TradeReceiptJob): Promise<void> {
    try {
      if (!(await this.repository.enabled(job.userId))) {
        await this.repository.complete(job.id);
        return;
      }
      const [email, receipt] = await Promise.all([
        this.auth.emailForUserId(job.userId),
        this.repository.receipt(job),
      ]);
      if (!email || !receipt) {
        await this.repository.complete(job.id);
        return;
      }
      const message = tradeReceiptEmail({
        ...receipt,
        email,
        transactionSignature: job.transactionSignature,
        network: this.env.SOLANA_NETWORK,
      });
      await this.emails.sendEmail(message);
      await this.repository.complete(job.id);
    } catch {
      await this.repository.retry(job);
      this.logger.warn(`Trade receipt delivery failed for job ${job.id}`);
    }
  }
}

export function tradeReceiptEmail(input: {
  email: string;
  ticker: string;
  side: 'buy' | 'sell';
  stockAmount: string;
  usdNotional: string;
  blockTime: Date;
  transactionSignature: string;
  network: 'mainnet' | 'devnet';
}) {
  const subject = `Trade confirmed: ${input.side} ${input.ticker}`;
  const transactionUrl = solscanUrl(input.transactionSignature, input.network);
  const amount = `${formatAmount(input.stockAmount)} ${input.ticker}`;
  const notional = `$${formatAmount(input.usdNotional)} USD`;
  const confirmedAt = input.blockTime.toISOString();
  const text = [
    `Your ${input.side} order for ${input.ticker} is confirmed.`,
    `Amount: ${amount}`,
    `Trade value: ${notional}`,
    `Confirmed at: ${confirmedAt}`,
    `Transaction: ${transactionUrl}`,
    '',
    'You received this message because trade receipts are enabled in your Oren settings.',
  ].join('\n');
  const html = [
    '<!doctype html><html><body style="margin:0;background:#f5f5fa;padding:32px;font-family:Arial,sans-serif;color:#171722">',
    '<main style="max-width:520px;margin:auto;background:#fff;border:1px solid #e5e5ef;border-radius:16px;padding:28px">',
    '<p style="margin:0 0 8px;color:#6259e8;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">Oren trade receipt</p>',
    `<h1 style="margin:0 0 20px;font-size:24px">${escapeHtml(input.side)} confirmed: ${escapeHtml(input.ticker)}</h1>`,
    '<table style="width:100%;border-collapse:collapse">',
    emailRow('Amount', amount),
    emailRow('Trade value', notional),
    emailRow('Confirmed', confirmedAt),
    '</table>',
    `<p style="margin:24px 0"><a href="${escapeHtml(transactionUrl)}" style="display:inline-block;background:#6259e8;color:#fff;text-decoration:none;border-radius:10px;padding:12px 18px">View transaction</a></p>`,
    '<p style="margin:24px 0 0;color:#666;font-size:12px;line-height:1.6">You received this message because trade receipts are enabled in your Oren settings. You can turn them off at any time from your account menu.</p>',
    '</main></body></html>',
  ].join('');

  return { to: input.email, subject, text, html } as const;
}

function emailRow(label: string, value: string): string {
  return `<tr><th align="left" style="padding:10px 0;color:#686879;font-size:13px;font-weight:500">${label}</th><td align="right" style="padding:10px 0;font-size:14px;font-weight:600">${escapeHtml(value)}</td></tr>`;
}

function formatAmount(value: string): string {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 8 }).format(
        parsed,
      )
    : value;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

function solscanUrl(signature: string, network: 'mainnet' | 'devnet') {
  const url = new URL(`https://solscan.io/tx/${encodeURIComponent(signature)}`);
  if (network === 'devnet') url.searchParams.set('cluster', 'devnet');
  return url.toString();
}
