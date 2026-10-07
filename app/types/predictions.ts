import type { PantaMarket } from './panta';

export interface PredictionMarket extends PantaMarket {
  relevance: { kind: 'direct' | 'macro' | 'general'; reason: string };
}
export interface PredictionSearch {
  q?: string;
  category?: 'finance' | 'crypto' | 'world';
  phase?: 'primary' | 'secondary' | 'resolved' | 'cancelled';
  assetIds?: string[];
  page?: number;
  limit?: number;
}
export interface PredictionResults {
  items: PredictionMarket[];
  page: number;
  hasMore: boolean;
  coverage: { scanned: number; complete: boolean; warnings: string[] };
}
export interface PredictionEvidence {
  text: string;
  sourceIds: string[];
}
export interface PredictionResearch {
  market: PredictionMarket;
  status: 'researched' | 'insufficient_evidence';
  generatedAt: string;
  summary: string;
  supporting: PredictionEvidence[];
  counterarguments: PredictionEvidence[];
  uncertainty: string[];
  unresolvedQuestions: string[];
  sources: Array<{ id: string; url: string; title: string; publishedAt: string | null; retrievedAt: string; kind: 'official' | 'secondary' | 'unverified' }>;
  portfolioRelevance: Array<{ assetId: string; ticker: string; allocationPct: number; kind: 'direct' | 'macro' }>;
  warnings: string[];
}
