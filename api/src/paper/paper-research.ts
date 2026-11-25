import { Inject, Injectable } from '@nestjs/common';
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
import { z } from 'zod';
import {
  InjectOpenAIClient,
  type OpenAIClient,
} from '../agent/openai.provider';
import { tradingSkills, tradingSkillVersion } from '../agent/trading-skills';
import { APP_ENV } from '../config/constants';
import type { AppEnv } from '../config/env.schema';
import {
  PAPER_MODEL,
  type PaperBar,
  type PaperBook,
  type PaperResearch,
  type PaperSignal,
} from '../../types/paper';
import { decide } from './strategy';
import type {
  MarketBook,
  PaperBarSource,
  ScreenRow,
} from '../../types/paper-market';

const selection = z
  .object({
    rule: z.enum(['breakout-v1', 'pullback-v1', 'cash']),
    rationale: z.string().trim().min(1).max(500),
  })
  .strict();
const descriptions = {
  inspectSignals:
    'Read deterministic breakout and pullback signals for this position.',
  inspectBars:
    'Inspect the last 21 completed hourly and daily candles behind these signals. barsSource "stock" means stock-market session candles for the company; "token" means on-chain candles for this exact mint.',
  inspectRisk:
    'Read virtual cash and holdings, entry allocation and decline from the recent closing peak.',
};
const tools: ChatCompletionTool[] = Object.entries(descriptions).map(
  ([name, description]) => ({
    type: 'function',
    function: {
      name,
      description,
      strict: true,
      parameters: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
  }),
);
const instructions = Object.entries(tradingSkills)
  .map(
    ([name, s]) =>
      name + ' — ' + s.guidance + ' Tools: ' + s.paperTools.join(', '),
  )
  .join('\n');

@Injectable()
export class PaperResearchAgent {
  constructor(
    @InjectOpenAIClient() private readonly client: OpenAIClient,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}
  async shortlist(universe: ScreenRow[], book: MarketBook): Promise<string[]> {
    if (!this.client) throw new Error('model_unavailable');
    const response = await this.client.chat.completions.create(
      {
        model: this.env.OPENAI_MODEL,
        max_completion_tokens: 2400,
        messages: [
          {
            role: 'system',
            content:
              instructions +
              '\nScreen the supplied full Oren market for swing setups. Each row has canonical id, ticker, price, 24h change, volume and liquidity. Choose up to three distinct ids to investigate in depth; an empty list is valid. Missing figures are unknown.',
          },
          {
            role: 'user',
            content: JSON.stringify({
              book,
              market: universe.map((r) => [
                r.id,
                r.ticker,
                r.price,
                r.change,
                r.volume,
                r.liquidity,
              ]),
            }),
          },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'paper_candidates',
            strict: true,
            schema: {
              type: 'object',
              properties: { ids: { type: 'array', items: { type: 'string' } } },
              required: ['ids'],
              additionalProperties: false,
            },
          },
        },
      },
      { timeout: 60000, maxRetries: 0 },
    );
    const { ids } = z
      .object({ ids: z.array(z.string()).max(3) })
      .strict()
      .parse(JSON.parse(response.choices[0]?.message.content ?? 'null'));
    if (
      !ids.every((id) => universe.some((r) => r.id === id)) ||
      new Set(ids).size !== ids.length
    )
      throw new Error('invalid_market_selection');
    return ids;
  }
  async investigate(
    asset: string,
    mint: string,
    daily: PaperBar[],
    hourly: PaperBar[],
    book: PaperBook,
    account?: MarketBook,
    barsSource: PaperBarSource = 'token',
  ): Promise<{ signal: PaperSignal; research: PaperResearch }> {
    const trendMean =
      daily.slice(0, -1).reduce((sum, bar) => sum + bar.close, 0) /
      (daily.length - 1);
    const trendAllowsEntry = daily.at(-1)!.close >= trendMean;
    const eligible = (rule: 'breakout-v1' | 'pullback-v1') => {
      const signal = decide(rule, hourly, book);
      return signal === 'buy' && !trendAllowsEntry ? 'hold' : signal;
    };
    const signals = {
      'breakout-v1': eligible('breakout-v1'),
      'pullback-v1': eligible('pullback-v1'),
    };
    const entryRule = account?.positions[asset]?.entryRule;
    const riskExit =
      book.position !== '0' &&
      (signals['breakout-v1'] === 'sell' ||
        decide('breakout-v1', daily, book) === 'sell' ||
        (entryRule === 'pullback-v1' && signals['pullback-v1'] === 'sell'));
    const research: PaperResearch = {
      version: tradingSkillVersion,
      model: this.env.OPENAI_MODEL,
      tools: [],
      selected: null,
      rationale: '',
    };
    const evidence = {
      inspectSignals: signals,
      inspectBars: { daily, hourly },
      inspectRisk: {
        book,
        trendMean,
        trendAllowsEntry,
        riskExit,
        entryRule,
        portfolio: account,
        entryCashBps: PAPER_MODEL.entryCashBps,
        declineFromPeakPct:
          100 *
          (1 - daily.at(-1)!.close / Math.max(...daily.map((r) => r.close))),
      },
    };
    const messages: ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content:
          instructions +
          '\nInvestigate this multi-day long-only paper account. Entries use hourly breakout or pullback timing with the daily trend filter. Select relevant distinct evidence tools in one batch. Then choose breakout-v1, pullback-v1, or cash and give an evidence-based rationale under 500 characters. Cash abstains from new entries. The engine enforces mandatory exits.',
      },
      {
        role: 'user',
        content: JSON.stringify({
          asset,
          mint,
          barsSource,
          hourlyBarTime: hourly.at(-1)!.time,
          dailyBarTime: daily.at(-1)!.time,
          trendAllowsEntry,
          riskExit,
          holding: book.position !== '0',
          signals,
        }),
      },
    ];
    try {
      if (!this.client) throw new Error('model_unavailable');
      const options = { timeout: 45000, maxRetries: 0 };
      const request = {
        model: this.env.OPENAI_MODEL,
        max_completion_tokens: 2200,
      };
      const response = await this.client.chat.completions.create(
        { ...request, messages, tools, tool_choice: 'required' },
        options,
      );
      const message = response.choices[0]?.message;
      if (!message?.tool_calls?.length || message.tool_calls.length > 3)
        throw new Error('invalid_tool_calls');
      messages.push(message);
      for (const call of message.tool_calls) {
        if (
          call.type !== 'function' ||
          !Object.hasOwn(evidence, call.function.name) ||
          !z.object({}).strict().safeParse(JSON.parse(call.function.arguments))
            .success
        )
          throw new Error('invalid_tool_calls');
        const name = call.function.name as keyof typeof evidence;
        research.tools.push(name);
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(evidence[name]),
        });
      }
      const completion = await this.client.chat.completions.create(
        {
          ...request,
          messages,
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'paper_rule',
              strict: true,
              schema: {
                type: 'object',
                properties: {
                  rule: { type: 'string', enum: selection.shape.rule.options },
                  rationale: { type: 'string' },
                },
                required: ['rule', 'rationale'],
                additionalProperties: false,
              },
            },
          },
        },
        options,
      );
      const choice = selection.parse(
        JSON.parse(completion.choices[0]?.message.content ?? 'null'),
      );
      research.selected = choice.rule;
      research.rationale = choice.rationale;
      return {
        signal: riskExit
          ? 'sell'
          : choice.rule === 'cash'
            ? 'hold'
            : signals[choice.rule],
        research,
      };
    } catch {
      research.error = 'research_unavailable';
      return { signal: riskExit ? 'sell' : 'hold', research };
    }
  }
}
