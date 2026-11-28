import type { JupiterClient } from '../execution/jupiter/jupiter.client';
export const PAPER_QUOTES = Symbol('PAPER_QUOTES');
export type PaperQuotes = Pick<JupiterClient, 'getQuote'>;
