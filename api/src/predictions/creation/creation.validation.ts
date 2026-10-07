import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import type {
  CreationTerms,
  CreationPayload,
} from '../../../types/prediction-creation';

export function publicHttps(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      isIP(host) ||
      host.includes(':') ||
      host === 'localhost' ||
      !host.includes('.') ||
      /\.(local|internal|localhost)$/.test(host)
    )
      return false;
    return value.length <= 2048;
  } catch {
    return false;
  }
}
export function validTimezone(zone: string) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone }).format();
    return true;
  } catch {
    return false;
  }
}
export function termsIssues(terms: CreationTerms, now = Date.now()): string[] {
  if (
    !terms ||
    typeof terms !== 'object' ||
    !Array.isArray(terms.assetIds) ||
    typeof terms.timezone !== 'string' ||
    typeof terms.resolutionRule !== 'string' ||
    typeof terms.measurement !== 'string' ||
    typeof terms.observationPolicy !== 'string' ||
    typeof terms.missingDataPolicy !== 'string'
  )
    return ['Provide valid creation terms.'];
  const issues: string[] = [];
  if (
    !['stock_threshold', 'stock_versus', 'crypto_threshold', 'macro'].includes(
      terms.template,
    )
  )
    issues.push('Select a supported investing template.');
  const category =
    terms.template === 'macro'
      ? 'world'
      : terms.template === 'crypto_threshold'
        ? 'crypto'
        : 'finance';
  if (terms.category !== category)
    issues.push('Category must match the investing template.');
  for (const [key, max] of [
    ['title', 512],
    ['question', 512],
    ['description', 4000],
    ['resolutionRule', 2048],
    ['measurement', 600],
    ['observationPolicy', 600],
    ['missingDataPolicy', 600],
  ] as const) {
    if (
      typeof terms[key] !== 'string' ||
      (key !== 'description' && !terms[key].trim()) ||
      terms[key].length > max
    )
      issues.push(`Provide valid ${key} (maximum ${max} characters).`);
  }
  if (
    !Array.isArray(terms.sourcesOfTruth) ||
    !terms.sourcesOfTruth.length ||
    terms.sourcesOfTruth.length > 20 ||
    !terms.sourcesOfTruth.every(publicHttps)
  )
    issues.push('Provide between one and 20 public HTTPS resolution sources.');
  if (
    !Array.isArray(terms.assetIds) ||
    terms.assetIds.length > 2 ||
    !terms.assetIds.every((id) => typeof id === 'string' && id.length <= 150)
  )
    issues.push('Invalid canonical asset identities.');
  if (
    terms.template === 'stock_versus' &&
    (terms.assetIds.length !== 2 || new Set(terms.assetIds).size !== 2)
  )
    issues.push('Versus markets require two distinct canonical stocks.');
  if (terms.template === 'stock_threshold' && terms.assetIds.length !== 1)
    issues.push('Select the exact canonical stock.');
  if (!validTimezone(terms.timezone)) issues.push('Provide an IANA timezone.');
  if (
    ![terms.startTime, terms.endTime, terms.resolutionTime].every(
      Number.isSafeInteger,
    ) ||
    !(terms.startTime < terms.endTime && terms.endTime <= terms.resolutionTime)
  )
    issues.push('Require start < end <= resolution as Unix seconds.');
  if (terms.startTime < Math.floor(now / 1000) + 3600)
    issues.push(
      'Start must be at least one hour in the future; provider minimum delay is checked again at quote.',
    );
  if (
    terms.marketType !== 'standard' ||
    terms.region !== 'Global' ||
    terms.tiePolicy !== 'NO'
  )
    issues.push(
      'Only standard, Global markets with ties resolving NO are supported.',
    );
  if (
    terms.template === 'stock_versus' &&
    (!/percent|percentage|%/i.test(terms.measurement) ||
      !/split/i.test(terms.observationPolicy) ||
      !/dividend/i.test(terms.observationPolicy))
  )
    issues.push(
      'Specify percentage returns, exact sessions, split adjustments and dividend exclusion.',
    );
  if (
    terms.template === 'stock_versus' &&
    !/underlying/i.test(terms.measurement)
  )
    issues.push(
      'Versus measurement must explicitly use underlying stock prices.',
    );
  if (
    ['stock_threshold', 'crypto_threshold'].includes(terms.template) &&
    (!/\d/.test(terms.measurement) ||
      !/(USD|USDC|EUR|GBP|JPY|currency)/i.test(terms.measurement) ||
      !/(>=|<=|>|<|greater|less|above|below|at least|at most|equal)/i.test(
        terms.measurement,
      ))
  )
    issues.push(
      'Threshold measurement must state currency, numeric threshold and comparison operator.',
    );
  if (
    terms.template === 'macro' &&
    (!/(first|revision)/i.test(terms.observationPolicy) ||
      !/(percent|%|index|rate|million|billion|thousand|persons|jobs|units)/i.test(
        terms.measurement,
      ))
  )
    issues.push(
      'Macro measurement must name units and first-publication/revision policy.',
    );
  const rule = composedRule(terms);
  if (rule.length > 2048)
    issues.push(
      'Combined contractual resolution rule exceeds 2048 characters.',
    );
  return [...new Set(issues)];
}
export function composedRule(terms: CreationTerms) {
  return `${terms.resolutionRule}\nMeasurement: ${terms.measurement}\nObservation: ${terms.observationPolicy}\nMissing data: ${terms.missingDataPolicy}\nExact tie: NO. Timezone: ${terms.timezone}.`;
}
export function creationPayload(
  wallet: string,
  terms: CreationTerms,
  imageUrl: string,
): CreationPayload {
  if (!publicHttps(imageUrl))
    throw new BadRequestException('Invalid uploaded artwork URL');
  return {
    wallet,
    question: terms.question,
    resolutionRule: composedRule(terms),
    sourcesOfTruth: [...terms.sourcesOfTruth],
    category: terms.category,
    startTime: terms.startTime,
    endTime: terms.endTime,
    resolutionTime: terms.resolutionTime,
    marketType: 'standard',
    title: terms.title,
    description: terms.description,
    region: 'Global',
    imageUrl,
  };
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, v]) => [key, canonical(v)]),
    );
  return value;
}
export const hashPayload = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
export function normalizedQuestion(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}
