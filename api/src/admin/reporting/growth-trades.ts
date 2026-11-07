export interface TradeIntentFact {
  id: string;
  userId: string;
  mode: 'browser' | 'delegated';
  status: 'prepared' | 'executing' | 'submitted' | 'confirmed' | 'failed';
  approvalId?: string | null;
}

export interface TradeApprovalFact {
  id: string;
  userId: string;
  executionId: string;
}

export interface ExecutionFact {
  id: string;
  status: string;
}

export interface TradeCounts {
  preparations: { browser: number; delegated: number; unlinkedBrowser: number };
  confirmed: { browser: number; delegated: number; unlinkedBrowser: number };
  uniqueActivatedAccounts: number;
  /** Wallet-only rows are not added into the account count. */
  unlinkedConfirmedExecutions: number;
  people: { status: 'unavailable'; reason: 'no_person_identifier' };
}

/**
 * One intent id is one preparation. A confirmed execution linked through an
 * approval is the same trade as its intent, not a second one.
 */
export function countTrades(input: {
  intents: TradeIntentFact[];
  approvals: TradeApprovalFact[];
  executions: ExecutionFact[];
}): TradeCounts {
  const intents = uniqueBy(input.intents, (row) => row.id);
  const approvals = new Map(input.approvals.map((row) => [row.id, row]));
  const executions = new Map(
    uniqueBy(input.executions, (row) => row.id).map((row) => [row.id, row]),
  );
  const linkedExecutionIds = new Set<string>();
  const accounts = new Set<string>();
  const preparations = { browser: 0, delegated: 0, unlinkedBrowser: 0 };
  const confirmed = { browser: 0, delegated: 0, unlinkedBrowser: 0 };

  for (const intent of intents) {
    preparations[intent.mode] += 1;
    const approval = intent.approvalId
      ? approvals.get(intent.approvalId)
      : undefined;
    if (approval) linkedExecutionIds.add(approval.executionId);
    if (intent.status === 'confirmed') {
      confirmed[intent.mode] += 1;
      accounts.add(intent.userId);
    }
  }

  let unlinkedConfirmed = 0;
  for (const execution of executions.values()) {
    if (linkedExecutionIds.has(execution.id)) continue;
    if (
      execution.status === 'preparing' ||
      execution.status === 'awaiting_signature' ||
      execution.status === 'submitted' ||
      execution.status === 'confirming' ||
      execution.status === 'confirmed'
    ) {
      preparations.unlinkedBrowser += 1;
    }
    if (execution.status === 'confirmed') {
      confirmed.unlinkedBrowser += 1;
      unlinkedConfirmed += 1;
    }
  }

  return {
    preparations,
    confirmed,
    uniqueActivatedAccounts: accounts.size,
    unlinkedConfirmedExecutions: unlinkedConfirmed,
    people: { status: 'unavailable', reason: 'no_person_identifier' },
  };
}

function uniqueBy<T>(rows: T[], key: (row: T) => string): T[] {
  return [...new Map(rows.map((row) => [key(row), row])).values()];
}
