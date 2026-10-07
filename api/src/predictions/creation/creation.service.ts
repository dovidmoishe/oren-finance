import {
  Injectable,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import bs58 from 'bs58';
import type {
  CreationProposeInput,
  CreationPatchInput,
  CreationPrepareInput,
  CreationConfirmInput,
  PredictionCreationDraft,
} from '../../../types/prediction-creation';
import { CreationRepository } from './creation.repository';
import { CreationResearchService } from './creation-research.service';
import { CreationArtworkService } from './creation-artwork.service';
import { CreationProvider } from './creation.provider';
import { CreationTransactionService } from './creation-transaction.service';
import { PredictionsService } from '../predictions.service';
import {
  creationPayload,
  hashPayload,
  normalizedQuestion,
  termsIssues,
} from './creation.validation';
import { ProviderError } from '../../common/errors/provider.errors';

@Injectable()
export class PredictionCreationService {
  constructor(
    private readonly repository: CreationRepository,
    private readonly research: CreationResearchService,
    private readonly artwork: CreationArtworkService,
    private readonly provider: CreationProvider,
    private readonly transactions: CreationTransactionService,
    private readonly predictions: PredictionsService,
  ) {}
  async propose(
    wallet: string,
    input: CreationProposeInput,
    signal?: AbortSignal,
  ) {
    const result = await this.research.research(
      input.intent,
      input.timezone ?? 'UTC',
      undefined,
      signal,
    );
    const now = new Date().toISOString();
    const draft: PredictionCreationDraft = {
      id: randomUUID(),
      wallet,
      version: 1,
      intent: input.intent,
      createdAt: now,
      updatedAt: now,
      ...result,
      artwork: await this.artwork.render(result.terms),
      payload: null,
      quote: null,
      attempt: null,
      duplicates: await this.duplicates(result.terms.question),
      blockingIssues: [],
      publicationBlockers: [],
    };
    this.annotate(draft);
    return this.repository.create(draft);
  }
  async get(wallet: string, id: string) {
    const draft = await this.repository.get(id, wallet);
    this.annotate(draft);
    return draft;
  }
  async releaseExpired(wallet: string, id: string) {
    return this.repository.locked(id, wallet, async (draft) => {
      const attempt = draft.attempt;
      if (!attempt || attempt.status !== 'prepared' || attempt.signature)
        throw new ConflictException(
          'Only an unsigned, expired preparation can be released',
        );
      if (
        !(await this.transactions.expiredUnsigned(
          attempt.prepared,
          attempt.quote.expectedEventPda,
        ))
      )
        throw new ConflictException(
          'Prepared transaction is still valid or its outcome is unknown',
        );
      attempt.status = 'failed';
      attempt.warning =
        'Unsigned transaction validity expired; review a fresh quote.';
      draft.quote = null;
      return Promise.resolve({ draft, value: draft });
    });
  }
  async reviseFromIntent(
    wallet: string,
    id: string,
    version: number,
    changes: string,
    signal?: AbortSignal,
  ) {
    if (!changes.trim() || changes.length > 4000)
      throw new BadRequestException('Describe the requested revision');
    const previous = await this.repository.get(id, wallet);
    this.version(previous, version);
    this.mutable(previous);
    const result = await this.research.research(
      `${previous.intent}\nRequested revision: ${changes}`,
      previous.terms.timezone,
      previous.terms,
      signal,
    );
    const draft: PredictionCreationDraft = {
      ...previous,
      ...result,
      version: version + 1,
      updatedAt: new Date().toISOString(),
      artwork: await this.artwork.render(result.terms),
      payload: null,
      quote: null,
      attempt: null,
      duplicates: await this.duplicates(result.terms.question),
    };
    this.annotate(draft);
    return this.repository.locked(id, wallet, (current) => {
      this.version(current, version);
      this.mutable(current);
      return Promise.resolve({ draft, value: draft });
    });
  }
  async revise(
    wallet: string,
    id: string,
    input: CreationPatchInput,
    signal?: AbortSignal,
  ) {
    const previous = await this.repository.get(id, wallet);
    this.version(previous, input.version);
    this.mutable(previous);
    if (!input.terms || typeof input.terms !== 'object')
      throw new BadRequestException('Terms required');
    const malformed = termsIssues(input.terms).filter((issue) =>
      /^Provide valid|Invalid canonical|supported investing|Category must|Only standard|IANA/.test(
        issue,
      ),
    );
    if (malformed.length) throw new BadRequestException(malformed);
    const result = input.research
      ? await this.research.research(
          previous.intent,
          input.terms.timezone,
          input.terms,
          signal,
        )
      : {
          terms: input.terms,
          evidence: {
            ...previous.evidence,
            status: 'insufficient_evidence' as const,
            sourcePolicySupported: false,
            summary: 'Terms changed. Research this version before quoting.',
          },
        };
    const draft: PredictionCreationDraft = {
      ...previous,
      ...result,
      version: previous.version + 1,
      updatedAt: new Date().toISOString(),
      artwork: await this.artwork.render(result.terms),
      payload: null,
      quote: null,
      attempt: null,
      duplicates: await this.duplicates(result.terms.question),
    };
    this.annotate(draft);
    return this.repository.locked(id, wallet, (current) => {
      this.version(current, input.version);
      this.mutable(current);
      return Promise.resolve({ draft, value: draft });
    });
  }
  async quote(wallet: string, id: string, version: number) {
    return this.repository.locked(id, wallet, async (draft) => {
      this.version(draft, version);
      this.mutable(draft);
      this.annotate(draft);
      if (draft.blockingIssues.length || draft.publicationBlockers.length)
        throw new ConflictException({
          code: 'PANTA_CREATE_BLOCKED',
          message: 'Resolve the draft and publication blockers before quoting',
          issues: [...draft.blockingIssues, ...draft.publicationBlockers],
        });
      const { manifest } = await this.transactions.network();
      if (
        draft.terms.startTime <
        Math.floor(Date.now() / 1000) + manifest.minimumStartDelay
      )
        throw new ConflictException(
          'Start date no longer meets verified minimum delay',
        );
      const imageUrl =
        draft.artwork.imageUrl ??
        (await this.provider.upload(
          Buffer.from(draft.artwork.previewDataUrl.split(',')[1], 'base64'),
        ));
      const payload = creationPayload(wallet, draft.terms, imageUrl),
        quote = await this.provider.quote(payload);
      draft.artwork.imageUrl = imageUrl;
      draft.payload = payload;
      draft.quote = {
        ...quote,
        payloadHash: hashPayload({
          payload,
          artworkHash: draft.artwork.contentHash,
        }),
        version,
      };
      draft.updatedAt = new Date().toISOString();
      return { draft, value: draft };
    });
  }
  async prepare(wallet: string, input: CreationPrepareInput) {
    return this.repository.locked(input.draftId, wallet, async (draft) => {
      this.version(draft, input.version);
      this.annotate(draft);
      if (draft.attempt && draft.attempt.status !== 'failed') {
        if (
          draft.attempt.status === 'prepared' &&
          draft.attempt.quote.createId === input.createId &&
          draft.attempt.quote.payloadHash === input.payloadHash &&
          draft.attempt.quote.paymentUsdc === input.paymentUsdc &&
          (!draft.duplicates.items.some((d) => d.exact) ||
            input.allowDuplicate === true) &&
          Date.parse(draft.attempt.prepared.expiresAt) > Date.now()
        )
          return { draft, value: draft.attempt.prepared };
        throw new ConflictException(
          'Existing creation attempt must be recovered; do not submit another payment',
        );
      }
      const quote = draft.quote;
      if (
        draft.blockingIssues.length ||
        draft.publicationBlockers.length ||
        !draft.payload ||
        !quote ||
        quote.createId !== input.createId ||
        quote.payloadHash !== input.payloadHash ||
        quote.paymentUsdc !== input.paymentUsdc ||
        quote.version !== input.version ||
        quote.payloadHash !==
          hashPayload({
            payload: draft.payload,
            artworkHash: draft.artwork.contentHash,
          }) ||
        Date.parse(quote.expiresAt) <= Date.now()
      )
        throw new ConflictException(
          'Proposal or quote changed/expired; review a fresh quote',
        );
      if (
        draft.duplicates.items.some((d) => d.exact) &&
        input.allowDuplicate !== true
      )
        throw new ConflictException(
          'An exact market exists; explicitly choose create another',
        );
      const build = await this.provider.build(quote.createId, wallet),
        verified = await this.transactions.verify(build, draft.payload, quote);
      const id = randomUUID();
      draft.attempt = {
        id,
        draftId: draft.id,
        version: draft.version,
        status: 'prepared',
        payload: structuredClone(draft.payload),
        artworkHash: draft.artwork.contentHash,
        providerDerived: build.derived,
        quote,
        prepared: { ...verified, attemptId: id },
      };
      return { draft, value: draft.attempt.prepared };
    });
  }
  async confirm(wallet: string, input: CreationConfirmInput) {
    try {
      if (bs58.decode(input.signature).length !== 64) throw new Error();
    } catch {
      throw new BadRequestException('Invalid transaction signature');
    }
    return this.repository.locked(input.draftId, wallet, async (draft) => {
      const attempt = draft.attempt;
      if (!attempt || attempt.id !== input.attemptId)
        throw new ConflictException('Creation attempt not found');
      if (attempt.signature && attempt.signature !== input.signature)
        throw new ConflictException(
          'Attempt already has a different signature',
        );
      if (attempt.status === 'registered') return { draft, value: attempt };
      if (attempt.status === 'failed')
        throw new ConflictException(
          'The submitted transaction failed; request a new reviewed quote',
        );
      // Persist the signature even on RPC/register failures by returning a pending status.
      attempt.signature = input.signature;
      try {
        const state = await this.transactions.confirmed(
          input.signature,
          attempt.prepared,
          attempt.quote.expectedEventPda,
        );
        if (state === 'failed') {
          attempt.status = 'failed';
          attempt.warning = 'Onchain transaction failed.';
        } else if (state === 'pending') {
          attempt.status = 'chain_pending';
          attempt.warning =
            'Transaction confirmation is pending; do not make another payment.';
        } else {
          attempt.status = 'registration_pending';
          try {
            attempt.marketId = await this.provider.register(
              attempt.quote.createId,
              input.signature,
              attempt.quote.expectedEventPda,
            );
            attempt.status = 'registered';
            attempt.warning = undefined;
            try {
              await this.predictions.detail(attempt.marketId);
            } catch {
              attempt.warning =
                'Market registered; catalog indexing is still pending.';
            }
          } catch (error) {
            attempt.warning =
              error instanceof ProviderError
                ? `Registration pending (${error.code}); retry this same signature.`
                : 'Registration pending; retry this same signature.';
          }
        }
      } catch (error) {
        if (
          error instanceof ProviderError &&
          error.code === 'PANTA_CREATE_TX_MISMATCH'
        )
          throw error;
        attempt.status = 'chain_pending';
        attempt.warning =
          'Chain verification unavailable; retry the same signature. Do not make another payment.';
      }
      return { draft, value: attempt };
    });
  }
  private version(draft: PredictionCreationDraft, version: number) {
    if (draft.version !== version)
      throw new ConflictException(
        'Draft version changed; reload before reviewing',
      );
  }
  private mutable(draft: PredictionCreationDraft) {
    if (draft.attempt && draft.attempt.status !== 'failed')
      throw new ConflictException(
        'Recover the existing creation attempt before changing terms or requesting another payment',
      );
  }
  private annotate(draft: PredictionCreationDraft) {
    draft.blockingIssues = termsIssues(draft.terms);
    if (
      draft.evidence.status !== 'researched' ||
      !draft.evidence.sources.length
    )
      draft.blockingIssues.push(
        'Cited event research is required for this draft version.',
      );
    if (!draft.evidence.sourcePolicySupported)
      draft.blockingIssues.push(
        'Evidence does not verify the proposed observations.',
      );
    draft.publicationBlockers = this.transactions.blockers();
    const m = this.transactions.manifest();
    if (m && !m.missingDataPolicies.includes(draft.terms.missingDataPolicy))
      draft.publicationBlockers.push(
        'Missing-data/suspension policy is not supported by the verified provider contract.',
      );
  }
  private async duplicates(
    question: string,
  ): Promise<PredictionCreationDraft['duplicates']> {
    try {
      const result = await this.predictions.search({ q: question, limit: 50 });
      return {
        items: result.items.map((m) => ({
          marketId: m.marketId,
          title: m.title,
          exact: normalizedQuestion(m.title) === normalizedQuestion(question),
        })),
        coverage: result.coverage,
      };
    } catch {
      return {
        items: [],
        coverage: {
          complete: false,
          scanned: 0,
          warnings: [
            'Duplicate scan unavailable; absence of duplicates is not verified.',
          ],
        },
      };
    }
  }
}
