import { relations } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  boolean,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/**
 * Postgres is Oren's application memory — not the financial ledger.
 * Required: portfolio_snapshots, stock_signals, executions, vault_positions
 * Optional: agent_threads, agent_messages, cached_news
 *
 * Equity registry / market data remains authoritative in Tokens API. Postgres
 * may keep short-lived read-through caches for responsive application reads.
 */

export const executionTypeEnum = pgEnum('execution_type', [
  'stock_purchase',
  'stock_sale',
  'basket_purchase',
  'lock',
  'unlock',
  'limit_buy',
  'limit_sell',
  'limit_cancel',
]);

export const limitOrderStatusEnum = pgEnum('limit_order_status', [
  'open',
  'filled',
  'cancelled',
  'expired',
  'failed',
  'awaiting_signature',
]);

export const limitOrderSideEnum = pgEnum('limit_order_side', ['buy', 'sell']);

export const executionStatusEnum = pgEnum('execution_status', [
  'preparing',
  'awaiting_signature',
  'submitted',
  'confirming',
  'confirmed',
  'failed',
]);

export const executionFeatureEnum = pgEnum('execution_feature', [
  'direct',
  'agent',
  'basket',
  'copy_trade',
  'limit_order',
]);

export const tradeSideEnum = pgEnum('trade_side', ['buy', 'sell']);

export const executionJobKindEnum = pgEnum('execution_job_kind', [
  'swap_fill',
  'limit_fill',
  'dune_sync',
]);

export const executionJobStatusEnum = pgEnum('execution_job_status', [
  'pending',
  'processing',
  'retry',
  'completed',
  'dead',
]);

export const agentMessageRoleEnum = pgEnum('agent_message_role', [
  'user',
  'assistant',
  'tool',
  'system',
]);

export const portfolioSnapshots = pgTable(
  'portfolio_snapshots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    walletAddress: text('wallet_address').notNull(),
    timestamp: timestamp('timestamp', { withTimezone: true })
      .defaultNow()
      .notNull(),
    totalValueUsd: numeric('total_value_usd', {
      precision: 20,
      scale: 8,
    }).notNull(),
    availableValueUsd: numeric('available_value_usd', {
      precision: 20,
      scale: 8,
    }).notNull(),
    lockedValueUsd: numeric('locked_value_usd', {
      precision: 20,
      scale: 8,
    }).notNull(),
    positionsJson: jsonb('positions_json').notNull().default([]),
  },
  (table) => [
    index('portfolio_snapshots_wallet_timestamp_idx').on(
      table.walletAddress,
      table.timestamp,
    ),
  ],
);

export const stockSignals = pgTable(
  'stock_signals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    assetId: text('asset_id').notNull(),
    ticker: text('ticker').notNull(),
    momentum7d: numeric('momentum_7d', { precision: 20, scale: 8 }).notNull(),
    momentum30d: numeric('momentum_30d', { precision: 20, scale: 8 }).notNull(),
    volatility30d: numeric('volatility_30d', {
      precision: 20,
      scale: 8,
    }).notNull(),
    volumeTrend: numeric('volume_trend', { precision: 20, scale: 8 }).notNull(),
    rsi14: numeric('rsi_14', { precision: 20, scale: 8 }).notNull(),
    sma20: numeric('sma_20', { precision: 20, scale: 8 }).notNull(),
    sma50: numeric('sma_50', { precision: 20, scale: 8 }).notNull(),
    liquidityScore: numeric('liquidity_score', {
      precision: 20,
      scale: 8,
    }).notNull(),
    activityScore: numeric('activity_score', {
      precision: 20,
      scale: 8,
    }).notNull(),
    opportunityScore: numeric('opportunity_score', {
      precision: 5,
      scale: 2,
    }).notNull(),
    calculatedAt: timestamp('calculated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('stock_signals_asset_id_idx').on(table.assetId),
    index('stock_signals_ticker_idx').on(table.ticker),
    index('stock_signals_opportunity_score_idx').on(table.opportunityScore),
  ],
);

/** Cached stock discovery data. Tokens remains the upstream source of truth. */
export const cachedStocks = pgTable(
  'cached_stocks',
  {
    assetId: text('asset_id').primaryKey(),
    ticker: text('ticker').notNull(),
    name: text('name').notNull(),
    category: text('category').notNull(),
    logo: text('logo'),
    price: numeric('price', { precision: 24, scale: 8 }),
    priceChange24h: numeric('price_change_24h', { precision: 20, scale: 8 }),
    volume24h: numeric('volume_24h', { precision: 28, scale: 8 }),
    liquidity: numeric('liquidity', { precision: 28, scale: 8 }),
    sortRank: integer('sort_rank').notNull(),
    cachedAt: timestamp('cached_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('cached_stocks_sort_rank_idx').on(table.sortRank),
    index('cached_stocks_ticker_idx').on(table.ticker),
    index('cached_stocks_expires_at_idx').on(table.expiresAt),
  ],
);

export const traderProfiles = pgTable(
  'trader_profiles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    walletAddress: text('wallet_address').notNull(),
    slug: text('slug').notNull(),
    displayName: text('display_name').notNull(),
    avatarUrl: text('avatar_url'),
    bio: text('bio'),
    isPublic: boolean('is_public').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('trader_profiles_wallet_address_idx').on(
      table.walletAddress,
    ),
    uniqueIndex('trader_profiles_slug_idx').on(table.slug),
    index('trader_profiles_is_public_idx').on(table.isPublic),
  ],
);

export const executions = pgTable(
  'executions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    walletAddress: text('wallet_address').notNull(),
    type: executionTypeEnum('type').notNull(),
    assetId: text('asset_id'),
    ticker: text('ticker'),
    tokenMint: text('token_mint'),
    inputAsset: text('input_asset'),
    outputAsset: text('output_asset'),
    amount: numeric('amount', { precision: 40, scale: 18 }),
    amountUsd: numeric('amount_usd', { precision: 20, scale: 8 }),
    provider: text('provider'),
    featureSource: executionFeatureEnum('feature_source')
      .notNull()
      .default('direct'),
    transactionSignature: text('transaction_signature'),
    status: executionStatusEnum('status').notNull().default('preparing'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
  },
  (table) => [
    index('executions_wallet_created_at_idx').on(
      table.walletAddress,
      table.createdAt,
    ),
    index('executions_status_idx').on(table.status),
    index('executions_asset_id_idx').on(table.assetId),
    uniqueIndex('executions_transaction_signature_idx').on(
      table.transactionSignature,
    ),
  ],
);

/** Verified Oren-routed stock/USDC fills. Public volume is aggregated only. */
export const tradeFills = pgTable(
  'trade_fills',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    executionId: uuid('execution_id').references(() => executions.id),
    orderKey: text('order_key'),
    transactionSignature: text('transaction_signature').notNull(),
    fillIndex: integer('fill_index').notNull().default(0),
    walletAddress: text('wallet_address').notNull(),
    assetId: text('asset_id').notNull(),
    ticker: text('ticker').notNull(),
    tokenMint: text('token_mint').notNull(),
    side: tradeSideEnum('side').notNull(),
    stockAmount: numeric('stock_amount', { precision: 40, scale: 18 }).notNull(),
    usdNotional: numeric('usd_notional', { precision: 28, scale: 8 }).notNull(),
    executionPriceUsd: numeric('execution_price_usd', {
      precision: 28,
      scale: 8,
    }).notNull(),
    featureSource: executionFeatureEnum('feature_source').notNull(),
    provider: text('provider').notNull(),
    slot: numeric('slot', { precision: 20, scale: 0 }).notNull(),
    blockTime: timestamp('block_time', { withTimezone: true }).notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('trade_fills_signature_asset_fill_idx').on(
      table.transactionSignature,
      table.assetId,
      table.fillIndex,
    ),
    index('trade_fills_asset_time_idx').on(table.assetId, table.blockTime),
    index('trade_fills_side_time_idx').on(table.side, table.blockTime),
    index('trade_fills_feature_time_idx').on(
      table.featureSource,
      table.blockTime,
    ),
  ],
);

/** Durable Postgres outbox. Workers lease rows; user requests never await RPC/Dune. */
export const executionJobs = pgTable(
  'execution_jobs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    kind: executionJobKindEnum('kind').notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    executionId: uuid('execution_id').references(() => executions.id),
    orderKey: text('order_key'),
    transactionSignature: text('transaction_signature'),
    status: executionJobStatusEnum('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    availableAt: timestamp('available_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lastError: text('last_error'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('execution_jobs_dedupe_key_idx').on(table.dedupeKey),
    index('execution_jobs_status_available_idx').on(
      table.status,
      table.availableAt,
    ),
  ],
);

export const vaultPositions = pgTable(
  'vault_positions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    lockAddress: text('lock_address').notNull(),
    owner: text('owner').notNull(),
    mint: text('mint').notNull(),
    assetId: text('asset_id'),
    ticker: text('ticker'),
    amount: numeric('amount', { precision: 40, scale: 18 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    unlockAt: timestamp('unlock_at', { withTimezone: true }).notNull(),
    transactionSignature: text('transaction_signature').notNull(),
    indexedAt: timestamp('indexed_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('vault_positions_lock_address_idx').on(table.lockAddress),
    index('vault_positions_owner_idx').on(table.owner),
    index('vault_positions_asset_id_idx').on(table.assetId),
    index('vault_positions_unlock_at_idx').on(table.unlockAt),
  ],
);

/** Jupiter Trigger V1 orders indexed for app memory (Jupiter remains ledger). */
export const limitOrders = pgTable(
  'limit_orders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    walletAddress: text('wallet_address').notNull(),
    orderKey: text('order_key').notNull(),
    side: limitOrderSideEnum('side').notNull(),
    assetId: text('asset_id'),
    ticker: text('ticker'),
    inputMint: text('input_mint').notNull(),
    outputMint: text('output_mint').notNull(),
    makingAmount: numeric('making_amount', {
      precision: 40,
      scale: 18,
    }).notNull(),
    takingAmount: numeric('taking_amount', {
      precision: 40,
      scale: 18,
    }).notNull(),
    limitPriceUsd: numeric('limit_price_usd', {
      precision: 20,
      scale: 8,
    }).notNull(),
    amountUsd: numeric('amount_usd', { precision: 20, scale: 8 }),
    status: limitOrderStatusEnum('status').notNull().default('open'),
    basis: text('basis'),
    openSignature: text('open_signature'),
    closeSignature: text('close_signature'),
    expiredAt: timestamp('expired_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('limit_orders_order_key_idx').on(table.orderKey),
    index('limit_orders_wallet_created_at_idx').on(
      table.walletAddress,
      table.createdAt,
    ),
    index('limit_orders_status_idx').on(table.status),
    index('limit_orders_asset_id_idx').on(table.assetId),
  ],
);

export const agentThreads = pgTable(
  'agent_threads',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    walletAddress: text('wallet_address').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('agent_threads_wallet_address_idx').on(table.walletAddress),
  ],
);

export const agentMessages = pgTable(
  'agent_messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => agentThreads.id, { onDelete: 'cascade' }),
    role: agentMessageRoleEnum('role').notNull(),
    content: text('content').notNull(),
    toolName: text('tool_name'),
    toolPayload: jsonb('tool_payload'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('agent_messages_thread_id_created_at_idx').on(
      table.threadId,
      table.createdAt,
    ),
  ],
);

/** Optional short-lived news cache — not a Tokens API mirror. */
export const cachedNews = pgTable(
  'cached_news',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    assetId: text('asset_id'),
    headline: text('headline').notNull(),
    source: text('source'),
    summary: text('summary'),
    url: text('url'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    payload: jsonb('payload'),
    cachedAt: timestamp('cached_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('cached_news_asset_id_idx').on(table.assetId),
    index('cached_news_expires_at_idx').on(table.expiresAt),
  ],
);

export const agentThreadsRelations = relations(agentThreads, ({ many }) => ({
  messages: many(agentMessages),
}));

export const agentMessagesRelations = relations(agentMessages, ({ one }) => ({
  thread: one(agentThreads, {
    fields: [agentMessages.threadId],
    references: [agentThreads.id],
  }),
}));
