import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_ENV } from '../../config/constants';
import type { AppEnv } from '../../config/env.schema';
import type { AttributionState, UtmTouch } from './growth-attribution';
import { chosenTouch } from './growth-attribution';
import type { PageviewDraft } from './growth-collect';
import { digest } from './growth-privacy';
import { observeGrowth } from './growth-observe';
import { GrowthRepository } from './growth.repository';

@Injectable()
export class GrowthRecorder {
  private readonly logger = new Logger(GrowthRecorder.name);

  constructor(
    private readonly repository: GrowthRepository,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  recordPageview(draft: PageviewDraft): Promise<void> {
    return observeGrowth(async () => {
      const result = await this.repository.insertPageview(draft);
      if (result === 'inserted' && draft.utmCampaign) {
        await this.rememberVisitor(draft.visitorHash, {
          source: draft.utmSource,
          medium: draft.utmMedium,
          campaign: draft.utmCampaign,
          content: draft.utmContent,
          term: draft.utmTerm,
          at: draft.occurredAt.toISOString(),
          path: draft.path,
        });
      }
    });
  }

  recordSetup(input: {
    occurredAt: Date;
    sourceId: string;
    sessionHash: string;
    slot: string | null;
    utm?: UtmTouch;
  }): Promise<void> {
    return observeGrowth(() =>
      this.repository.insertFunnel({
        occurredAt: input.occurredAt,
        eventType: 'setup_cta',
        sessionHash: input.sessionHash,
        sourceId: input.sourceId,
        slot: input.slot,
        utm: input.utm,
      }),
    );
  }

  recordOauth(input: {
    eventType:
      | 'oauth_completed'
      | 'oauth_refused'
      | 'oauth_failed'
      | 'oauth_expired'
      | 'oauth_revoked';
    occurredAt?: Date;
    accountId?: string;
    sourceId: string;
    attribution?: AttributionState;
  }): Promise<void> {
    return observeGrowth(async () => {
      const occurredAt = input.occurredAt ?? new Date();
      const accountHash = input.accountId
        ? digest(this.pepper, 'account', input.accountId)
        : null;
      const touch = chosenTouch(
        input.attribution ?? {},
        this.env.GROWTH_ATTRIBUTION_MODEL,
        occurredAt,
        this.env.GROWTH_ATTRIBUTION_WINDOW_DAYS,
      );
      if (input.attribution?.visitorId) {
        const visitorHash = digest(
          this.pepper,
          'beacon',
          input.attribution.visitorId,
        );
        if (input.attribution.first) {
          await this.repository.rememberTouch(
            'visitor',
            visitorHash,
            'first',
            input.attribution.first,
          );
        }
        if (input.attribution.last) {
          await this.repository.rememberTouch(
            'visitor',
            visitorHash,
            'last',
            input.attribution.last,
          );
        }
      }
      if (accountHash && touch) {
        await this.repository.rememberTouch(
          'account',
          accountHash,
          'first',
          touch,
        );
        await this.repository.rememberTouch(
          'account',
          accountHash,
          'last',
          touch,
        );
      }
      await this.repository.insertFunnel({
        occurredAt,
        eventType: input.eventType,
        accountHash,
        sourceId: input.sourceId,
        utm: touch,
        isFirst: false,
      });
    });
  }

  recordResearch(input: {
    accountId: string;
    sourceId: string;
    lane: 'in_app';
    tool: 'getStockResearch';
  }): Promise<void> {
    return observeGrowth(() =>
      this.repository.insertFunnel({
        occurredAt: new Date(),
        eventType: 'research_success',
        accountHash: digest(this.pepper, 'account', input.accountId),
        sourceId: input.sourceId,
        lane: input.lane,
        toolName: input.tool,
        isFirst: true,
      }),
    );
  }

  private async rememberVisitor(
    visitorHash: string,
    touch: UtmTouch,
  ): Promise<void> {
    try {
      await this.repository.rememberTouch(
        'visitor',
        visitorHash,
        'first',
        touch,
      );
      await this.repository.rememberTouch(
        'visitor',
        visitorHash,
        'last',
        touch,
      );
    } catch (error) {
      this.logger.warn(`Attribution touch was not stored: ${errorName(error)}`);
    }
  }

  private get pepper(): string {
    return this.env.GROWTH_HASH_KEY || 'oren-growth-unset-pepper';
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'Error';
}
