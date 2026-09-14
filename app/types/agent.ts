import type {
  BasketResponse,
  ExecutionPreparedTransaction,
  PreparedBasketPurchase,
  QuoteResponse,
} from './execution';
import type { PortfolioSummary } from './portfolio';
import type { StockAnalysis, StockDetail, StockSummary } from './stock';
import type { PreparedVaultTransaction, VaultPosition } from './vault';
import type { CopyPortfolioProposal } from './social';

export type AgentPage = 'dashboard' | 'leaderboard' | 'markets' | 'stock' | 'vault' | 'activity';
export type AgentRole = 'user' | 'assistant';
export type AgentToolStatus = 'running' | 'completed' | 'failed';

export interface AgentPageContext {
  page: AgentPage;
  assetId?: string;
}

export interface AgentToolActivity {
  callId: string;
  toolName: string;
  status: AgentToolStatus;
  error?: string;
}

export interface AgentVaultSummary {
  walletAddress: string;
  totalLockedValueUsd: number;
  positions: VaultPosition[];
}

export type AgentArtifact =
  | { type: 'portfolio'; data: PortfolioSummary }
  | { type: 'stock'; data: StockDetail }
  | { type: 'analysis'; data: StockAnalysis }
  | { type: 'opportunities'; data: StockSummary[] }
  | { type: 'quote'; data: QuoteResponse }
  | { type: 'prepared_swap'; data: ExecutionPreparedTransaction }
  | { type: 'basket'; data: BasketResponse }
  | { type: 'prepared_basket'; data: PreparedBasketPurchase }
  | { type: 'prepared_lock'; data: PreparedVaultTransaction }
  | { type: 'prepared_unlock'; data: PreparedVaultTransaction }
  | { type: 'copy_portfolio_proposal'; data: CopyPortfolioProposal }
  | { type: 'vaults'; data: AgentVaultSummary };

export interface AgentDisplayMessage {
  id: string;
  role: AgentRole;
  content: string;
  createdAt: string;
  activities?: AgentToolActivity[];
  artifacts?: AgentArtifact[];
  interrupted?: boolean;
  streaming?: boolean;
}

export interface AgentRecentThread {
  id: string;
  title: string;
  updatedAt: string;
}

export interface AgentRequest {
  walletAddress: string;
  threadId?: string;
  message: string;
  context?: AgentPageContext;
}

export interface AgentResponse {
  threadId: string;
  message: AgentDisplayMessage;
  artifacts?: AgentArtifact[];
  events?: AgentStreamEvent[];
}

export interface AgentThreadMessagesResponse {
  thread: {
    id: string;
    walletAddress: string;
    createdAt: string;
    updatedAt: string;
  };
  messages: AgentDisplayMessage[];
}

interface AgentStreamEventBase {
  turnId: string;
  sequence: number;
  timestamp: string;
}

export type AgentStreamEvent =
  | (AgentStreamEventBase & {
      type: 'turn_started';
      threadId: string;
      message: AgentDisplayMessage;
    })
  | (AgentStreamEventBase & { type: 'assistant_delta'; delta: string })
  | (AgentStreamEventBase & {
      type: 'tool_started';
      callId: string;
      toolName: string;
    })
  | (AgentStreamEventBase & {
      type: 'tool_completed';
      callId: string;
      toolName: string;
      artifact?: AgentArtifact;
    })
  | (AgentStreamEventBase & {
      type: 'tool_failed';
      callId: string;
      toolName: string;
      error: string;
    })
  | (AgentStreamEventBase & {
      type: 'turn_completed';
      threadId: string;
      message: AgentDisplayMessage;
      artifacts?: AgentArtifact[];
    })
  | (AgentStreamEventBase & {
      type: 'turn_failed';
      error: { code: string; message: string; retryable: boolean };
    });
