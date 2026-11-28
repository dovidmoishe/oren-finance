import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  InjectOpenAIClient,
  type OpenAIClient,
} from '../agent/openai.provider';
import { tradingSkills } from '../agent/trading-skills';
import { APP_ENV } from '../config/constants';
import type { AppEnv } from '../config/env.schema';
import type { PaperResearch } from '../../types/paper';
import type { SetupEvidence } from './swing';

export const SETUP_REVIEW_VERSION = 'setup-review-v2';

const selection = z
  .object({
    rule: z.enum(['breakout-v1', 'pullback-v1', 'cash']),
    rationale: z.string().trim().min(1).max(500),
  })
  .strict();

const guidance = [
  tradingSkills['factor-research'].guidance,
  tradingSkills['data-validation'].guidance,
].join(' ');

export const SETUP_REVIEW_PROMPT = [
  'You review long-only swing-trade entries for an Oren paper account.',
  guidance,
  'The engine has already found this setup: at least one entry rule in entryRules signals a buy on completed candles of the stated timeframe, and the daily trend filter allows entries. Every setup reaches you, so most breakouts you see will fail; your job is to keep the ones the evidence favours and skip the rest. Skipping is the default.',
  'Position size, position limits, stops and exits are deterministic and are not your decision. Decide only whether this setup deserves an entry.',
  'Bars are oldest first as [high, low, close]. Prices are rebased so the latest close on the timeframe is 100. momentumPct is the 20-session daily change. assetDeclineFromHighPct is how far the latest daily close sits below the highest daily close shown; it describes the asset, not the account.',
  "features: volumeRatio is the breakout session volume over its 20-session average (null when unknown); extensionPct is how far the close sits above the prior 20-session high; avgRangePct is the typical daily range, so compare extension with it; relativeMomentumPct is the asset's 20-session change minus the Nasdaq 100 tracker's.",
  "market: index is the Nasdaq 100 tracker's trend; breadthPct is the share of scanned stocks above their own 20-day mean; setups is how many entries the scan found at once.",
  'Weigh volume confirmation, extension against the typical range, relative strength and the market backdrop together. Choose one rule from entryRules to enter, or cash to skip. Give a rationale under 500 characters that cites only the supplied figures.',
].join('\n');

export interface SetupReviewer {
  review(evidence: SetupEvidence): Promise<PaperResearch>;
}

/** The AI step of the paper trader: one structured call per entry setup. */
@Injectable()
export class PaperResearchAgent implements SetupReviewer {
  constructor(
    @InjectOpenAIClient() private readonly client: OpenAIClient,
    @Inject(APP_ENV) private readonly env: Pick<AppEnv, 'PAPER_AI_MODEL'>,
  ) {}

  get model() {
    return this.env.PAPER_AI_MODEL;
  }

  /** A failed or invalid review abstains (cash) and records the error. */
  async review(evidence: SetupEvidence): Promise<PaperResearch> {
    const research: PaperResearch = {
      version: SETUP_REVIEW_VERSION,
      model: this.env.PAPER_AI_MODEL,
      rationale: '',
      selected: null,
    };
    try {
      if (!this.client) throw new Error('model_unavailable');
      const completion = await this.client.chat.completions.create(
        {
          model: this.env.PAPER_AI_MODEL,
          max_completion_tokens: 4000,
          messages: [
            { role: 'system', content: SETUP_REVIEW_PROMPT },
            { role: 'user', content: JSON.stringify(evidence) },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'paper_entry_review',
              strict: true,
              schema: {
                type: 'object',
                properties: {
                  rule: {
                    type: 'string',
                    enum: selection.shape.rule.options,
                  },
                  rationale: { type: 'string' },
                },
                required: ['rule', 'rationale'],
                additionalProperties: false,
              },
            },
          },
        },
        { timeout: 90000, maxRetries: 1 },
      );
      const choice = selection.parse(
        JSON.parse(completion.choices[0]?.message.content ?? 'null'),
      );
      research.rationale = choice.rationale;
      // A rule that is not signalling a buy cannot enter; record it as a skip.
      research.selected =
        choice.rule === 'cash' || evidence.entryRules.includes(choice.rule)
          ? choice.rule
          : 'cash';
      if (research.selected !== choice.rule)
        research.error = 'rule_not_signalling';
    } catch {
      research.error = 'research_unavailable';
      research.selected = 'cash';
    }
    return research;
  }
}
