/**
 * Canonical bytes for an owner-reviewed Privy policy.
 *
 * PolicyRuleResponse adds a server-assigned rule `id` (absent from the create
 * body; condition schemas have no id). Privy may also return `rules` in a
 * different order without setting `updated_at`. The fingerprint allowlists
 * semantic fields, so ids never enter the hash, and then restores the order
 * emitted by build-launch-policy.mjs and build-proof-policy.mjs.
 *
 * That order is what SIGNER_GATE_POLICY_HASH was computed from. A lexical sort
 * of rule JSON would not reproduce it. Ranking reviewed names and condition
 * fields in builder order makes this a no-op for those policies, so the
 * existing pin stays valid. Duplicate names and unknown fields tie-break on
 * canonical JSON, so the result is a pure function of the multiset.
 *
 * `in` values are sets. They are sorted with the same default string order
 * the mint builder already uses. IDL key order is preserved: it is part of
 * the reviewed hash, and reordering those keys must still change the pin.
 */

const RULE_NAMES = [
  'deny after proof expiry',
  'deny after policy expiry',
  'allow compute budget',
  'allow bounded jupiter buy',
  'allow bounded jupiter sell',
  'allow idempotent stock account',
  'allow idempotent usdc account',
];

const CONDITION_FIELDS = [
  ['solana_program_instruction', 'programId'],
  ['solana_instruction_data', 'shared_accounts_route.args.in_amount'],
  ['solana_instruction_data', 'shared_accounts_route.args.quoted_out_amount'],
  ['solana_instruction_data', 'shared_accounts_route.args.slippage_bps'],
  ['solana_instruction_data', 'shared_accounts_route.args.platform_fee_bps'],
  ['solana_instruction_data', 'shared_accounts_route.accounts.source_mint'],
  [
    'solana_instruction_data',
    'shared_accounts_route.accounts.destination_mint',
  ],
  [
    'solana_instruction_data',
    'shared_accounts_route.accounts.source_token_account',
  ],
  [
    'solana_instruction_data',
    'shared_accounts_route.accounts.destination_token_account',
  ],
  ['solana_instruction_data', 'create_idempotent.accounts.mint'],
  ['solana_instruction_data', 'create_idempotent.accounts.system_program'],
  ['solana_instruction_data', 'create_idempotent.accounts.token_program'],
  ['system', 'current_unix_timestamp'],
];

const RULE_RANK = new Map(RULE_NAMES.map((name, index) => [name, index]));
const CONDITION_RANK = new Map(
  CONDITION_FIELDS.map(([source, field], index) => [
    `${source}\0${field}`,
    index,
  ]),
);

function compareText(left, right) {
  const a = left ?? '';
  const b = right ?? '';
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function methodGroup(method) {
  if (method === 'signTransaction') return 0;
  if (method === 'signAndSendTransaction') return 1;
  return 2;
}

function normalizeValue(operator, value) {
  if (
    operator === 'in' &&
    Array.isArray(value) &&
    value.every((item) => typeof item === 'string')
  )
    return [...value].sort();
  return value;
}

function normalizeCondition(item) {
  return {
    field_source: item.field_source,
    field: item.field,
    operator: item.operator,
    value: normalizeValue(item.operator, item.value),
    idl: 'idl' in item ? (item.idl ?? null) : null,
  };
}

function compareConditions(left, right) {
  const rank =
    (CONDITION_RANK.get(`${left.field_source}\0${left.field}`) ??
      CONDITION_FIELDS.length) -
    (CONDITION_RANK.get(`${right.field_source}\0${right.field}`) ??
      CONDITION_FIELDS.length);
  if (rank) return rank;
  return (
    compareText(left.field_source, right.field_source) ||
    compareText(left.field, right.field) ||
    compareText(JSON.stringify(left), JSON.stringify(right))
  );
}

function compareRules(left, right) {
  const method = methodGroup(left.method) - methodGroup(right.method);
  if (method) return method;
  const rank =
    (RULE_RANK.get(left.name) ?? RULE_NAMES.length) -
    (RULE_RANK.get(right.name) ?? RULE_NAMES.length);
  if (rank) return rank;
  return (
    compareText(left.name, right.name) ||
    compareText(JSON.stringify(left), JSON.stringify(right))
  );
}

function normalizePolicySemantics(policy) {
  return {
    owner_id: policy.owner_id,
    chain_type: policy.chain_type,
    version: policy.version,
    rules: policy.rules
      ?.map((rule) => ({
        name: rule.name,
        method: rule.method,
        action: rule.action,
        conditions: rule.conditions
          ?.map(normalizeCondition)
          .sort(compareConditions),
      }))
      .sort(compareRules),
  };
}

module.exports = { normalizePolicySemantics };
