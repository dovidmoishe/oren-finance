import bs58 from 'bs58';
import { PredictionCreationService } from './creation.service';
import { emptyCreationTerms } from './creation-research.service';
import { creationPayload, hashPayload } from './creation.validation';
import type { PredictionCreationDraft } from '../../../types/prediction-creation';
describe('Creation approval and recovery', () => {
  let draft: PredictionCreationDraft;
  const research = { research: jest.fn() },
    artwork = { render: jest.fn() },
    provider = {
      quote: jest.fn(),
      build: jest.fn(),
      register: jest.fn(),
      upload: jest.fn(),
    },
    transactions = {
      blockers: jest.fn(),
      manifest: jest.fn(),
      verify: jest.fn(),
      confirmed: jest.fn(),
      expiredUnsigned: jest.fn(),
    },
    predictions = { search: jest.fn(), detail: jest.fn() };
  const repository = { get: jest.fn(), create: jest.fn(), locked: jest.fn() };
  const service = () =>
    new PredictionCreationService(
      repository as never,
      research as never,
      artwork as never,
      provider as never,
      transactions as never,
      predictions as never,
    );
  const signature = bs58.encode(new Uint8Array(64).fill(1));
  const request = () => ({
    draftId: draft.id,
    version: 1,
    createId: 'quote',
    payloadHash: draft.quote!.payloadHash,
    paymentUsdc: '25000000',
    allowDuplicate: false,
  });
  beforeEach(() => {
    jest.resetAllMocks();
    const terms = {
      ...emptyCreationTerms('Will GDP rise?', 'UTC'),
      resolutionRule: 'GDP above 2 percent YES, otherwise NO',
      measurement: 'GDP growth percent, first official release',
      observationPolicy: 'First publication on 2026-12-01 at 08:30 UTC',
      missingDataPolicy: 'Cancel missing observation',
      sourcesOfTruth: ['https://www.bea.gov/gdp'],
    };
    const payload = creationPayload(
      'wallet',
      terms,
      'https://res.cloudinary.com/art.png',
    );
    draft = {
      id: 'draft',
      wallet: 'wallet',
      version: 1,
      intent: 'GDP',
      createdAt: 'now',
      updatedAt: 'now',
      terms,
      payload,
      evidence: {
        status: 'researched',
        generatedAt: 'now',
        summary: 'Evidence',
        sources: [
          {
            id: 's1',
            url: terms.sourcesOfTruth[0],
            title: 'BEA',
            kind: 'official',
            publishedAt: null,
            retrievedAt: 'now',
          },
        ],
        supporting: [],
        counterarguments: [],
        uncertainty: [],
        unresolvedQuestions: [],
        sourcePolicySupported: true,
      },
      artwork: {
        contentHash: 'art',
        imageUrl: payload.imageUrl,
        previewDataUrl: 'data:image/png;base64,cG5n',
        warnings: [],
      },
      quote: {
        createId: 'quote',
        expectedEventPda: 'event',
        paymentUsdc: '25000000',
        liquidityInjectionUsdc: '20000000',
        platformRevenueUsdc: '5000000',
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        version: 1,
        payloadHash: hashPayload({ payload, artworkHash: 'art' }),
      },
      attempt: null,
      duplicates: {
        items: [],
        coverage: { complete: false, scanned: 100, warnings: ['partial'] },
      },
      blockingIssues: [],
      publicationBlockers: [],
    };
    repository.get.mockImplementation(() =>
      Promise.resolve(structuredClone(draft)),
    );
    repository.locked.mockImplementation(
      async (
        _id,
        _wallet,
        run: (
          draft: PredictionCreationDraft,
        ) => Promise<{ draft: PredictionCreationDraft; value: unknown }>,
      ) => {
        const result = await run(structuredClone(draft));
        draft = result.draft;
        return result.value;
      },
    );
    transactions.blockers.mockReturnValue([]);
    transactions.manifest.mockReturnValue({
      missingDataPolicies: [terms.missingDataPolicy],
    });
    provider.build.mockResolvedValue({ derived: { event: 'event' } });
    transactions.verify.mockResolvedValue({
      transaction: 'unsigned',
      recentBlockhash: 'block',
      lastValidBlockHeight: 100,
      buildFingerprint: 'fp',
      messageHash: 'hash',
      genesisHash: 'genesis',
      networkFeeLamports: '5000',
      expiresAt: draft.quote.expiresAt,
    });
    transactions.confirmed.mockResolvedValue('confirmed');
    provider.register.mockResolvedValue('event');
    predictions.detail.mockResolvedValue({});
  });
  it('rejects version/fee/artwork changes, expired quotes and unapproved exact duplicates', async () => {
    const s = service();
    await expect(
      s.prepare('wallet', { ...request(), version: 2 }),
    ).rejects.toThrow();
    await expect(
      s.prepare('wallet', { ...request(), paymentUsdc: '1' }),
    ).rejects.toThrow();
    draft.artwork.contentHash = 'changed';
    await expect(s.prepare('wallet', request())).rejects.toThrow();
    draft.artwork.contentHash = 'art';
    draft.duplicates.items = [
      { marketId: 'same', title: draft.terms.question, exact: true },
    ];
    await expect(s.prepare('wallet', request())).rejects.toThrow('explicitly');
    draft.duplicates.items = [];
    draft.quote!.expiresAt = '2000-01-01';
    await expect(s.prepare('wallet', request())).rejects.toThrow();
    expect(provider.build).not.toHaveBeenCalled();
  });
  it('reuses a matching unsigned attempt, but cannot change its payment or create another', async () => {
    const s = service(),
      input = request(),
      prepared = await s.prepare('wallet', input);
    expect(await s.prepare('wallet', input)).toEqual(prepared);
    expect(provider.build).toHaveBeenCalledTimes(1);
    await expect(
      s.prepare('wallet', { ...input, paymentUsdc: '1' }),
    ).rejects.toThrow('recovered');
    await expect(
      s.revise('wallet', draft.id, {
        version: 1,
        terms: draft.terms,
        research: false,
      }),
    ).rejects.toThrow('Recover');
  });
  it('keeps a successful payment pending after failed registration and retries the same attempt', async () => {
    const s = service(),
      prepared = await s.prepare('wallet', request());
    provider.register.mockRejectedValueOnce(new Error('unavailable'));
    const input = {
      draftId: draft.id,
      attemptId: prepared.attemptId,
      signature,
    };
    expect((await s.confirm('wallet', input)).status).toBe(
      'registration_pending',
    );
    expect(draft.attempt!.signature).toBe(signature);
    await expect(s.prepare('wallet', request())).rejects.toThrow('recovered');
    expect((await s.confirm('wallet', input)).status).toBe('registered');
    await s.confirm('wallet', input);
    expect(provider.register).toHaveBeenCalledTimes(2);
    expect(provider.build).toHaveBeenCalledTimes(1);
    await expect(
      s.confirm('wallet', {
        ...input,
        signature: bs58.encode(new Uint8Array(64).fill(2)),
      }),
    ).rejects.toThrow('different signature');
  });
  it('preserves unknown chain outcomes and reports catalog indexing lag separately', async () => {
    const s = service(),
      prepared = await s.prepare('wallet', request()),
      input = { draftId: draft.id, attemptId: prepared.attemptId, signature };
    transactions.confirmed.mockRejectedValueOnce(new Error('RPC failure'));
    expect((await s.confirm('wallet', input)).status).toBe('chain_pending');
    expect(provider.register).not.toHaveBeenCalled();
    predictions.detail.mockRejectedValueOnce(new Error('indexer lag'));
    const result = await s.confirm('wallet', input);
    expect(result.status).toBe('registered');
    expect(result.warning).toContain('indexing');
  });
  it('releases only proven expired unsigned attempts; submitted attempts stay locked', async () => {
    const s = service(),
      prepared = await s.prepare('wallet', request());
    transactions.expiredUnsigned.mockResolvedValue(false);
    await expect(s.releaseExpired('wallet', draft.id)).rejects.toThrow(
      'unknown',
    );
    transactions.expiredUnsigned.mockResolvedValue(true);
    expect((await s.releaseExpired('wallet', draft.id)).attempt!.status).toBe(
      'failed',
    );
    draft.attempt!.status = 'prepared';
    draft.attempt!.signature = signature;
    await expect(s.releaseExpired('wallet', draft.id)).rejects.toThrow(
      'unsigned',
    );
    expect(prepared.attemptId).toBe(draft.attempt!.id);
  });
  it('blocks publication before upload and marks evidence stale after edits', async () => {
    const s = service();
    transactions.blockers.mockReturnValue(['No verified deployment']);
    await expect(s.quote('wallet', draft.id, 1)).rejects.toThrow();
    expect(provider.upload).not.toHaveBeenCalled();
    artwork.render.mockResolvedValue(draft.artwork);
    predictions.search.mockResolvedValue({
      items: [],
      coverage: { complete: false, scanned: 100, warnings: ['partial'] },
    });
    const updated = await s.revise('wallet', draft.id, {
      version: 1,
      terms: { ...draft.terms, title: 'Changed' },
      research: false,
    });
    expect(updated.version).toBe(2);
    expect(updated.quote).toBeNull();
    expect(updated.evidence.status).toBe('insufficient_evidence');
  });
});
