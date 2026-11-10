import { planAgentTurn, stripUnsolicitedTradeOffer } from './agent-turn';

const TRANSCRIPT = [
  'i want a stock mix for 100 on tech and ai companies that have the best sentiment in the market',
  'brief me a bit more on what these companies do bro and lets discuss em',
  'what do each of these have to do with ai bro ?',
  'can we go over the mastercard bro ?',
  'whats the report on nvidia',
  'i mean company repott',
];

describe('copilot research turn', () => {
  it('does not treat a sentiment mix as an opportunity-score ranking', () => {
    const plan = planAgentTurn({
      message: TRANSCRIPT[0] ?? '',
      writerOpinionsEnabled: false,
    });

    expect(plan.focus).toBe('sentiment');
    expect(plan.userAskedToTrade).toBe(false);
    expect(plan.instruction).toContain('Turn: sentiment');
    expect(plan.instruction).toMatch(/does not mean opportunityScore/);
    expect(plan.instruction).toMatch(/momentum, trend, and trading activity/);
    expect(plan.instruction).toMatch(/Writer opinions are not available/);
    expect(plan.instruction).toMatch(/findOpportunities/);
    expect(plan.instruction).toMatch(/Do not invent what a company does/);
    expect(plan.instruction).toMatch(/Do not offer a buy quote/);
  });

  it('keeps an explicit chart question on the technical read', () => {
    const plan = planAgentTurn({
      message: 'analyze the NVDA chart',
      writerOpinionsEnabled: false,
    });

    expect(plan.focus).toBe('technical');
    expect(plan.instruction).toContain('analyzeStock');
    expect(plan.instruction).not.toContain('Turn: company');
  });

  it('routes what-they-do and AI follow-ups to company substance', () => {
    const history = [
      { role: 'user', content: TRANSCRIPT[0] ?? '' },
      {
        role: 'assistant',
        content:
          'Take-Two, Anduril, Kalshi, and Mastercard, ranked by opportunity score.',
      },
    ];
    const brief = planAgentTurn({
      message: TRANSCRIPT[1] ?? '',
      history,
      writerOpinionsEnabled: false,
    });
    const ai = planAgentTurn({
      message: TRANSCRIPT[2] ?? '',
      history,
      writerOpinionsEnabled: false,
    });
    const mastercard = planAgentTurn({
      message: TRANSCRIPT[3] ?? '',
      history,
      writerOpinionsEnabled: false,
    });

    for (const plan of [brief, ai, mastercard]) {
      expect(plan.focus).toBe('company');
      expect(plan.instruction).toMatch(/getStockResearch/);
      expect(plan.instruction).toMatch(/Do not call analyzeStock/);
      expect(plan.instruction).toMatch(/Do not invent/);
      expect(plan.userAskedToTrade).toBe(false);
    }
  });

  it('routes the NVIDIA report and the company-report correction off the price read', () => {
    const history = [
      { role: 'user', content: TRANSCRIPT[4] ?? '' },
      {
        role: 'assistant',
        content:
          'NVIDIA has been falling and is close to a level where buyers have stepped in before (~$175).',
      },
    ];
    const report = planAgentTurn({
      message: TRANSCRIPT[4] ?? '',
      writerOpinionsEnabled: false,
    });
    const correction = planAgentTurn({
      message: TRANSCRIPT[5] ?? '',
      history,
      writerOpinionsEnabled: false,
    });

    expect(report.focus).toBe('company');
    expect(report.instruction).toMatch(/getStockResearch/);
    expect(report.instruction).toMatch(/Do not call analyzeStock/);
    expect(report.instruction).toMatch(/SEC company facts/);
    expect(correction.focus).toBe('company');
    expect(correction.instruction).toMatch(/Do not repeat/);
    expect(correction.instruction).toMatch(/do not substitute a price read/i);
    expect(correction.instruction).not.toMatch(/before any Oren read/);
  });

  it('still allows an explicit buy to reach the trade tools', () => {
    const plan = planAgentTurn({
      message: 'buy $20 of nvidia',
      writerOpinionsEnabled: false,
    });

    expect(plan.userAskedToTrade).toBe(true);
    expect(plan.instruction).toMatch(/Do not prepare, sign, or broadcast/);
    expect(plan.instruction).not.toMatch(/Do not offer a buy quote/);
  });
});

describe('unsolicited trade offers', () => {
  const mix =
    "Here's a $100 tech mix from the names with the strongest momentum.\n- Take-Two — $30.\nWant me to prepare buy quotes or limit orders for this $100 mix?";
  const mastercard =
    'Mastercard has been climbing, with selling interest near ~$668.\nWant me to propose a Jupiter Trigger limit buy around ~$605.84?';

  it('removes the trailing quote and limit-order offers from the transcript', () => {
    expect(stripUnsolicitedTradeOffer(mix, false)).toBe(
      "Here's a $100 tech mix from the names with the strongest momentum.\n- Take-Two — $30.",
    );
    expect(stripUnsolicitedTradeOffer(mastercard, false)).toBe(
      'Mastercard has been climbing, with selling interest near ~$668.',
    );
  });

  it('keeps an offer when the user asked to trade', () => {
    expect(stripUnsolicitedTradeOffer(mix, true)).toBe(mix);
  });
});
