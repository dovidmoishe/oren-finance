import type { OpenAIClient } from '../agent/openai.provider';
import { PaperResearchAgent, SETUP_REVIEW_PROMPT } from './paper-research';
import type { SetupEvidence } from './swing';

const evidence: SetupEvidence = {
  version: 'daily-breakout-v1',
  timeframe: 'daily',
  hourly: [],
  daily: Array.from({ length: 21 }, (_, i) => [
    100.5,
    99.5,
    i === 20 ? 100 : 98,
  ]),
  trendMean: 98,
  trendAllowsEntry: true,
  signals: { 'breakout-v1': 'buy', 'pullback-v1': 'hold' },
  entryRules: ['breakout-v1'],
  momentumPct: 2.04,
  assetDeclineFromHighPct: 0,
  features: {
    volumeRatio: 1.8,
    avgRangePct: 1.2,
    extensionPct: 0.4,
    relativeMomentumPct: 3.1,
  },
  market: {
    index: { aboveTrend: true, change20dPct: -1.06, change5dPct: 0.8 },
    breadthPct: 55,
    setups: 2,
  },
};
const answer = (content: unknown) => ({
  choices: [{ message: { content: JSON.stringify(content) } }],
});

describe('AI setup review', () => {
  const env = { PAPER_AI_MODEL: 'test-model' };

  it('sends the evidence in one structured request and records the chosen rule', async () => {
    const create = jest
      .fn()
      .mockResolvedValue(
        answer({ rule: 'breakout-v1', rationale: 'Close above prior highs.' }),
      );
    const agent = new PaperResearchAgent(
      { chat: { completions: { create } } } as unknown as OpenAIClient,
      env,
    );
    await expect(agent.review(evidence)).resolves.toEqual({
      version: 'setup-review-v2',
      model: 'test-model',
      rationale: 'Close above prior highs.',
      selected: 'breakout-v1',
    });
    expect(create).toHaveBeenCalledTimes(1);
    const [request] = create.mock.calls[0] as [
      { messages: { role: string; content: string }[] },
    ];
    expect(request.messages).toEqual([
      { role: 'system', content: SETUP_REVIEW_PROMPT },
      { role: 'user', content: JSON.stringify(evidence) },
    ]);
    // The prompt separates the asset's decline from the account, defaults to skipping and explains every measure.
    expect(SETUP_REVIEW_PROMPT).toContain('not the account');
    expect(SETUP_REVIEW_PROMPT).toContain('Skipping is the default');
    for (const field of [
      'volumeRatio',
      'extensionPct',
      'avgRangePct',
      'relativeMomentumPct',
      'breadthPct',
    ])
      expect(SETUP_REVIEW_PROMPT).toContain(field);
    const [, options] = create.mock.calls[0] as [unknown, { timeout: number }];
    expect(options.timeout).toBeGreaterThanOrEqual(90000);
  });

  it('turns a rule that is not signalling into a recorded skip', async () => {
    const create = jest
      .fn()
      .mockResolvedValue(answer({ rule: 'pullback-v1', rationale: 'Dip.' }));
    const agent = new PaperResearchAgent(
      { chat: { completions: { create } } } as unknown as OpenAIClient,
      env,
    );
    await expect(agent.review(evidence)).resolves.toMatchObject({
      selected: 'cash',
      error: 'rule_not_signalling',
    });
  });

  it('abstains when the model is unavailable or answers out of schema', async () => {
    await expect(
      new PaperResearchAgent(null, env).review(evidence),
    ).resolves.toMatchObject({
      selected: 'cash',
      error: 'research_unavailable',
    });
    const create = jest.fn().mockResolvedValue(answer({ rule: 'all-in' }));
    const agent = new PaperResearchAgent(
      { chat: { completions: { create } } } as unknown as OpenAIClient,
      env,
    );
    await expect(agent.review(evidence)).resolves.toMatchObject({
      selected: 'cash',
      error: 'research_unavailable',
    });
  });
});
