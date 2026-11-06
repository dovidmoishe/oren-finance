export function policyAllowsStock(
  policy: {
    rules?: {
      action: string;
      conditions?: {
        field_source: string;
        field: string;
        operator: string;
        value: unknown;
      }[];
    }[];
  },
  mint: string,
): boolean {
  return (
    !!mint &&
    (policy.rules ?? []).some(
      (rule) =>
        rule.action === 'ALLOW' &&
        (rule.conditions ?? []).some(
          (c) =>
            c.field_source === 'solana_instruction_data' &&
            c.operator === 'in' &&
            [
              'shared_accounts_route.accounts.source_mint',
              'shared_accounts_route.accounts.destination_mint',
            ].includes(c.field) &&
            Array.isArray(c.value) &&
            c.value.includes(mint),
        ),
    )
  );
}
