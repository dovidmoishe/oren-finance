import type { AppEnv } from '../config/env.schema';
import type { OpenAIClient } from '../agent/openai.provider';
import { PaperResearchAgent } from './paper-research';
import { DAY, INITIAL } from './strategy';

describe('guided paper strategy', () => {
  const rows = Array.from({ length: 21 }, (_, i) => ({
    time: i * DAY,
    high: i === 20 ? 115 : 100,
    low: 99,
    close: i === 20 ? 110 : 100,
  }));
  const env = { OPENAI_MODEL: 'test' } as AppEnv;
  it('consumes a selected evidence tool and maps the chosen rule to the computed signal', async () => {
    const create = jest
      .fn()
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              role: 'assistant',
              tool_calls: [
                {
                  id: 'signal',
                  type: 'function',
                  function: { name: 'inspectSignals', arguments: '{}' },
                },
              ],
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                rule: 'breakout-v1',
                rationale: 'Close exceeded the prior highs.',
              }),
            },
          },
        ],
      });
    const agent = new PaperResearchAgent(
      { chat: { completions: { create } } } as unknown as OpenAIClient,
      env,
    );
    // Flat daily trend permits entry. Only the hourly close breaks the 20-bar high.
    const daily = rows.map((r) => ({ ...r, close: 100, high: 100 }));
    const result = await agent.investigate(
      'asset',
      'mint',
      daily,
      rows,
      INITIAL,
    );
    expect(result).toMatchObject({
      signal: 'buy',
      research: {
        version: 'swing-research-v1',
        tools: ['inspectSignals'],
        selected: 'breakout-v1',
      },
    });
    const weakDaily = [...daily.slice(0, -1), { ...daily[20], close: 99 }];
    const calls = create.mock.calls as [{ messages: unknown[] }, unknown][];
    expect(calls[1][0].messages).toContainEqual({
      role: 'tool',
      tool_call_id: 'signal',
      content: JSON.stringify({ 'breakout-v1': 'buy', 'pullback-v1': 'hold' }),
    });
    create
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              role: 'assistant',
              tool_calls: [
                {
                  id: 'signal',
                  type: 'function',
                  function: { name: 'inspectSignals', arguments: '{}' },
                },
              ],
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                rule: 'breakout-v1',
                rationale: 'Hourly breakout.',
              }),
            },
          },
        ],
      });
    expect(
      (await agent.investigate('asset', 'mint', weakDaily, rows, INITIAL))
        .signal,
    ).toBe('hold');
  });
  it('abstains on a model outage and still enforces a mandatory exit', async () => {
    const agent = new PaperResearchAgent(null, env);
    expect(
      await agent.investigate('asset', 'mint', rows, rows, INITIAL),
    ).toMatchObject({
      signal: 'hold',
      research: { error: 'research_unavailable' },
    });
    const dropping = [
      ...rows.slice(0, -1),
      { time: 20 * DAY, high: 90, low: 85, close: 86 },
    ];
    expect(
      await agent.investigate('asset', 'mint', rows, dropping, {
        cash: '9000000000',
        position: '1',
      }),
    ).toMatchObject({ signal: 'sell' });
  });
});
