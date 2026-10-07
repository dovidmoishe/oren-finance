import type { PredictionResearch } from './predictions';

export type CreationTemplate =
  'stock_threshold' | 'stock_versus' | 'crypto_threshold' | 'macro';
export interface CreationTerms {
  template: CreationTemplate;
  assetIds: string[];
  title: string;
  question: string;
  description: string;
  resolutionRule: string;
  sourcesOfTruth: string[];
  category: 'finance' | 'crypto' | 'world';
  startTime: number;
  endTime: number;
  resolutionTime: number;
  timezone: string;
  observationPolicy: string;
  missingDataPolicy: string;
  /** Exact underlying instrument and observation/session definition. */
  measurement: string;
  tiePolicy: 'NO';
  marketType: 'standard';
  region: 'Global';
}
export interface CreationPayload {
  wallet: string;
  question: string;
  resolutionRule: string;
  sourcesOfTruth: string[];
  category: CreationTerms['category'];
  startTime: number;
  endTime: number;
  resolutionTime: number;
  marketType: 'standard';
  title: string;
  description: string;
  region: 'Global';
  imageUrl: string;
}
export interface CreationEvidence {
  status: 'researched' | 'insufficient_evidence';
  generatedAt: string;
  summary: string;
  supporting: PredictionResearch['supporting'];
  counterarguments: PredictionResearch['counterarguments'];
  sources: PredictionResearch['sources'];
  uncertainty: string[];
  unresolvedQuestions: string[];
  /** Explicitly requested by the draft research, not inferred settlement terms. */
  sourcePolicySupported: boolean;
}
export interface CreationQuote {
  createId: string;
  expectedEventPda: string;
  paymentUsdc: string;
  liquidityInjectionUsdc: string;
  platformRevenueUsdc: string;
  expiresAt: string;
  payloadHash: string;
  version: number;
}
export interface CreationPrepared {
  attemptId: string;
  transaction: string;
  recentBlockhash: string;
  lastValidBlockHeight: number;
  buildFingerprint: string;
  messageHash: string;
  genesisHash: string;
  networkFeeLamports: string;
  expiresAt: string;
}
export type CreationAttemptStatus =
  | 'prepared'
  | 'chain_pending'
  | 'registration_pending'
  | 'registered'
  | 'failed';
export interface CreationAttempt {
  id: string;
  draftId: string;
  version: number;
  status: CreationAttemptStatus;
  payload: CreationPayload;
  artworkHash: string;
  providerDerived: Record<string, string>;
  quote: CreationQuote;
  prepared: CreationPrepared;
  signature?: string;
  marketId?: string;
  warning?: string;
}
export interface PredictionCreationDraft {
  id: string;
  wallet: string;
  version: number;
  intent: string;
  createdAt: string;
  updatedAt: string;
  terms: CreationTerms;
  evidence: CreationEvidence;
  artwork: {
    contentHash: string;
    previewDataUrl: string;
    imageUrl: string | null;
    warnings: string[];
  };
  payload: CreationPayload | null;
  quote: CreationQuote | null;
  attempt: CreationAttempt | null;
  duplicates: {
    items: { marketId: string; title: string; exact: boolean }[];
    coverage: { complete: boolean; scanned: number; warnings: string[] };
  };
  blockingIssues: string[];
  publicationBlockers: string[];
}
export interface CreationProposeInput {
  intent: string;
  timezone?: string;
}
export interface CreationPatchInput {
  version: number;
  terms: CreationTerms;
  research: boolean;
}
export interface CreationPrepareInput {
  draftId: string;
  version: number;
  createId: string;
  payloadHash: string;
  paymentUsdc: string;
  allowDuplicate: boolean;
}
export interface CreationConfirmInput {
  draftId: string;
  attemptId: string;
  signature: string;
}
