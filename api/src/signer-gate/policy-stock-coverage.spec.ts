import { policyAllowsStock } from './policy-stock-coverage';
it('uses the pinned allowlist rather than accepting a stock only because it is catalogued', () => {
  const c = {
    field_source: 'solana_instruction_data',
    field: 'shared_accounts_route.accounts.source_mint',
    operator: 'in',
    value: ['supported'],
  };
  expect(
    policyAllowsStock(
      { rules: [{ action: 'ALLOW', conditions: [c] }] },
      'supported',
    ),
  ).toBe(true);
  expect(
    policyAllowsStock(
      { rules: [{ action: 'ALLOW', conditions: [c] }] },
      'other',
    ),
  ).toBe(false);
  expect(
    policyAllowsStock(
      { rules: [{ action: 'DENY', conditions: [c] }] },
      'supported',
    ),
  ).toBe(false);
});
