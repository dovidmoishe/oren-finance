import type { BasketResponse, PreparedTransaction, QuoteResponse } from "./execution";
import type { PortfolioSummary } from "./portfolio";
import type { StockAnalysis, StockDetail, StockSummary } from "./stock";
import type { VaultPosition } from "./vault";

export type AgentRole = "user" | "assistant" | "tool";

export interface AgentMessage {
  id: string;
  role: AgentRole;
  content: string;
  createdAt: string;
  artifacts?: AgentArtifact[];
}

export type AgentArtifact =
  | { type: "portfolio"; data: PortfolioSummary }
  | { type: "stock"; data: StockDetail }
  | { type: "analysis"; data: StockAnalysis }
  | { type: "opportunities"; data: StockSummary[] }
  | { type: "quote"; data: QuoteResponse }
  | { type: "prepared_transaction"; data: PreparedTransaction }
  | { type: "basket"; data: BasketResponse }
  | { type: "vaults"; data: VaultPosition[] };

export interface AgentRequest {
  wallet?: string;
  threadId?: string;
  message: string;
}

export interface AgentResponse {
  threadId: string;
  messages: AgentMessage[];
  artifacts?: AgentArtifact[];
}
