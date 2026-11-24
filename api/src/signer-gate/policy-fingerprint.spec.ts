import { createHash } from 'node:crypto';
import {
  gatePolicyFingerprint,
  gatePolicyRulesValid,
} from './signer-gate.service';

jest.mock('@privy-io/node', () =>
  jest.requireActual<typeof import('../test/privy-authorization.mock')>(
    '../test/privy-authorization.mock',
  ),
);

/** Serializer pinned in production on 12 Nov 2026, before order normalization. */
function legacyFingerprint(policy: {
  owner_id?: string;
  chain_type?: string;
  version?: string;
  rules?: {
    name?: string;
    method?: string;
    action?: string;
    conditions?: Record<string, unknown>[];
  }[];
}) {
  const normalized = {
    owner_id: policy.owner_id,
    chain_type: policy.chain_type,
    version: policy.version,
    rules: policy.rules?.map((rule) => ({
      name: rule.name,
      method: rule.method,
      action: rule.action,
      conditions: rule.conditions?.map((item) => ({
        field_source: item.field_source,
        field: item.field,
        operator: item.operator,
        value: item.value,
        idl: 'idl' in item ? (item.idl ?? null) : null,
      })),
    })),
  };
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

const idl = {
  address: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
  metadata: { name: 'jupiter', version: '0.1.0', spec: '0.1.0' },
  zLast: true,
};
const stock = 'TSLAqBbv4CNCnzWFeB7LmydAyEiNMJtve7DYKLpdK4S';
const other = 'BSLAqBbv4CNCnzWFeB7LmydAyEiNMJtve7DYKLpdK4S';
const usdc = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

function data(
  field: string,
  operator: string,
  value: string | string[],
): Record<string, unknown> {
  return {
    field_source: 'solana_instruction_data',
    idl,
    field: `shared_accounts_route.${field}`,
    operator,
    value,
  };
}

/** Reviewed builder order for the until-revoked account-creation policy. */
function reviewedPolicy() {
  const buyConditions = [
    {
      field_source: 'solana_program_instruction',
      field: 'programId',
      operator: 'eq',
      value: idl.address,
    },
    data('args.in_amount', 'lte', '25000000'),
    data('args.slippage_bps', 'lte', '50'),
    data('args.platform_fee_bps', 'eq', '0'),
    data('accounts.source_mint', 'eq', usdc),
    data('accounts.destination_mint', 'in', [other, stock]),
  ];
  const sellConditions = [
    {
      field_source: 'solana_program_instruction',
      field: 'programId',
      operator: 'eq',
      value: idl.address,
    },
    data('args.quoted_out_amount', 'lte', '25000000'),
    data('args.slippage_bps', 'lte', '50'),
    data('args.platform_fee_bps', 'eq', '0'),
    data('accounts.source_mint', 'in', [other, stock]),
    data('accounts.destination_mint', 'eq', usdc),
  ];
  return {
    owner_id: 'separate-policy-owner',
    chain_type: 'solana',
    version: '1.0',
    rules: [
      {
        name: 'allow compute budget',
        method: 'signTransaction',
        action: 'ALLOW',
        conditions: [
          {
            field_source: 'solana_program_instruction',
            field: 'programId',
            operator: 'eq',
            value: 'ComputeBudget111111111111111111111111111111',
          },
        ],
      },
      {
        name: 'allow bounded jupiter buy',
        method: 'signTransaction',
        action: 'ALLOW',
        conditions: buyConditions,
      },
      {
        name: 'allow bounded jupiter sell',
        method: 'signTransaction',
        action: 'ALLOW',
        conditions: sellConditions,
      },
      {
        name: 'allow idempotent stock account',
        method: 'signTransaction',
        action: 'ALLOW',
        conditions: [
          {
            field_source: 'solana_program_instruction',
            field: 'programId',
            operator: 'eq',
            value: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
          },
          {
            field_source: 'solana_instruction_data',
            field: 'create_idempotent.accounts.mint',
            operator: 'in',
            value: [other, stock],
            idl,
          },
        ],
      },
      {
        name: 'allow idempotent usdc account',
        method: 'signTransaction',
        action: 'ALLOW',
        conditions: [
          {
            field_source: 'solana_program_instruction',
            field: 'programId',
            operator: 'eq',
            value: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
          },
          {
            field_source: 'solana_instruction_data',
            field: 'create_idempotent.accounts.mint',
            operator: 'eq',
            value: usdc,
            idl,
          },
        ],
      },
    ],
  };
}

function shuffled<T extends { rules: Array<{ conditions: unknown[] }> }>(
  policy: T,
) {
  const clone = structuredClone(policy) as T & {
    id: string;
    name: string;
    created_at: string;
    updated_at: null;
    rules: Array<{ id: string; conditions: unknown[] }>;
  };
  clone.id = 'policy-id';
  clone.name = 'server name';
  clone.created_at = '2026-11-12T00:00:00.000Z';
  clone.updated_at = null;
  clone.rules = [...clone.rules].reverse().map((rule, index) => ({
    ...rule,
    id: `rule-${index}`,
    conditions: [...rule.conditions].reverse().map((condition) => {
      const item = condition as { value?: unknown };
      return {
        ...item,
        id: `condition-${index}`,
        value: Array.isArray(item.value)
          ? item.value.slice().reverse()
          : item.value,
      };
    }),
  }));
  return clone;
}

describe('signer policy fingerprint', () => {
  it('keeps the pre-fix hash when Privy reorders rules and adds ids', () => {
    const policy = reviewedPolicy();
    const mixed = shuffled(policy);
    expect(gatePolicyFingerprint(policy as never)).toBe(
      legacyFingerprint(policy),
    );
    expect(gatePolicyFingerprint(mixed as never)).toBe(
      legacyFingerprint(policy),
    );
    expect(JSON.stringify(policy)).not.toBe(JSON.stringify(mixed));
  });

  it('keeps the pre-fix hash for the three-rule proof policy shape', () => {
    const policy = {
      owner_id: 'proof-owner',
      chain_type: 'solana',
      version: '1.0',
      rules: [
        {
          name: 'deny after proof expiry',
          method: 'signTransaction',
          action: 'DENY',
          conditions: [
            {
              field_source: 'system',
              field: 'current_unix_timestamp',
              operator: 'gte',
              value: '200000',
            },
          ],
        },
        {
          name: 'allow compute budget',
          method: 'signTransaction',
          action: 'ALLOW',
          conditions: [
            {
              field_source: 'solana_program_instruction',
              field: 'programId',
              operator: 'eq',
              value: 'ComputeBudget111111111111111111111111111111',
            },
          ],
        },
        {
          name: 'allow bounded jupiter buy',
          method: 'signTransaction',
          action: 'ALLOW',
          conditions: [
            {
              field_source: 'solana_program_instruction',
              field: 'programId',
              operator: 'eq',
              value: idl.address,
            },
            data('args.in_amount', 'lte', '1000000'),
            data('args.slippage_bps', 'lte', '50'),
            data('accounts.source_mint', 'eq', usdc),
            data('accounts.destination_mint', 'eq', stock),
            data('accounts.source_token_account', 'eq', 'source-ata'),
            data('accounts.destination_token_account', 'eq', 'destination-ata'),
          ],
        },
      ],
    };
    expect(gatePolicyFingerprint(shuffled(policy) as never)).toBe(
      legacyFingerprint(policy),
    );
  });

  it('changes when owner, chain, version, cap, mint, action, method, or a rule changes', () => {
    const policy = reviewedPolicy();
    const original = gatePolicyFingerprint(policy as never);
    const snapshot = structuredClone(policy);
    const buy = policy.rules[1];
    const cap = buy.conditions[1];
    const mint = buy.conditions[5];

    policy.owner_id = 'other-owner';
    expect(gatePolicyFingerprint(policy as never)).not.toBe(original);
    policy.owner_id = snapshot.owner_id;
    policy.chain_type = 'ethereum';
    expect(gatePolicyFingerprint(policy as never)).not.toBe(original);
    policy.chain_type = snapshot.chain_type;
    policy.version = '2.0';
    expect(gatePolicyFingerprint(policy as never)).not.toBe(original);
    policy.version = snapshot.version;
    cap.value = '1';
    expect(gatePolicyFingerprint(policy as never)).not.toBe(original);
    cap.value = '25000000';
    mint.value = ['not-a-reviewed-mint'];
    expect(gatePolicyFingerprint(policy as never)).not.toBe(original);
    mint.value = [other, stock];
    buy.action = 'DENY';
    expect(gatePolicyFingerprint(policy as never)).not.toBe(original);
    buy.action = 'ALLOW';
    buy.method = 'signMessage';
    expect(gatePolicyFingerprint(policy as never)).not.toBe(original);
    buy.method = 'signTransaction';
    expect(gatePolicyFingerprint(policy as never)).toBe(original);

    const removed = {
      ...policy,
      rules: policy.rules.filter((rule) => rule !== buy),
    };
    expect(gatePolicyFingerprint(removed as never)).not.toBe(original);

    const twin = structuredClone(buy);
    twin.conditions[1].value = '3';
    expect(
      gatePolicyFingerprint({
        ...policy,
        rules: [...policy.rules, twin],
      } as never),
    ).toBe(
      gatePolicyFingerprint({
        ...policy,
        rules: [twin, ...policy.rules],
      } as never),
    );
    expect(
      gatePolicyFingerprint({
        ...policy,
        rules: [...policy.rules, twin],
      } as never),
    ).not.toBe(original);
    expect(JSON.stringify(policy)).toBe(JSON.stringify(snapshot));
  });

  it('accepts sponsored copies only when every rewritten rule still matches', () => {
    const policy = reviewedPolicy();
    policy.rules = policy.rules.slice(0, 3);
    const sponsored = structuredClone(policy.rules).map((rule) => ({
      ...rule,
      method: 'signAndSendTransaction',
    }));
    policy.rules.push(...sponsored);
    expect(gatePolicyRulesValid(policy as never, true)).toBe(true);
    policy.rules.reverse();
    expect(gatePolicyRulesValid(policy as never, true)).toBe(true);
    sponsored[0].action = 'DENY';
    expect(gatePolicyRulesValid(policy as never, true)).toBe(false);
  });
});
