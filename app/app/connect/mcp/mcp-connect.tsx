'use client';

import { useEffect, useState } from 'react';
import { useOrenAuth } from '@/components/auth/auth-context';
import Link from 'next/link';
import { mcpApiOrigin } from '@/services/mcp-api-origin';

type Interaction = { clientId: string; scope: string; resource: string };

/** OAuth consent uses Oren's existing Privy email OTP sign-in dialog. */
export function McpConnect({ uid }: { uid: string }) {
  const auth = useOrenAuth();
  const [details, setDetails] = useState<Interaction>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [allowExecute, setAllowExecute] = useState(false);
  const apiOrigin = mcpApiOrigin();
  const requestsExecute = details?.scope.split(/\s+/).includes('oren.trade.execute') ?? false;

  useEffect(() => {
    if (!uid || !apiOrigin) return;
    const controller = new AbortController();
    void fetch(`${apiOrigin}/oauth/interaction/${encodeURIComponent(uid)}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('This connection request expired. Start again in your agent.');
        return (await response.json()) as Interaction;
      })
      .then(setDetails)
      .catch(() => {
        if (!controller.signal.aborted)
          setError('This connection request expired. Start again in your agent.');
      });
    return () => controller.abort();
  }, [uid, apiOrigin]);

  async function authorize() {
    if (!apiOrigin || !uid || !details || !auth.authenticated || !auth.address || (requestsExecute && !allowExecute)) return;
    setBusy(true);
    setError(undefined);
    try {
      const token = await auth.getAccessToken();
      if (!token) throw new Error('Your session expired. Sign in again.');
      const response = await fetch(`${apiOrigin}/oauth/interaction/${encodeURIComponent(uid)}`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          Authorization: `Bearer ${token}`,
          ...(requestsExecute ? { 'X-Oren-Trade-Execute-Consent': 'true' } : {}),
        },
      });
      if (!response.ok) throw new Error('Unable to authorize this connection. Start again in your agent.');
      const body = (await response.json()) as { redirect?: string };
      const redirect = new URL(body.redirect ?? '');
      if (redirect.origin !== apiOrigin || !redirect.pathname.startsWith('/oauth/'))
        throw new Error('Invalid authorization redirect.');
      window.location.assign(redirect.href);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to connect.');
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-lg px-5 py-16 text-foreground">
      <h1 className="text-3xl font-semibold">Connect Oren</h1>
      <p className="mt-3 text-muted">Sign in with the same email and one-time code you use for Oren.</p>
      {details && <div className="mt-8 rounded-2xl border border-border bg-panel p-5">
        <p className="text-sm text-muted">Agent client</p>
        <p className="mt-1 break-all font-medium">{details.clientId}</p>
        <p className="mt-5 text-sm text-muted">Access requested</p>
        <p className="mt-1">
          {details.scope.includes('oren.read') ? 'Read your portfolio and stock market data. ' : ''}
          {details.scope.includes('oren.trade.prepare') ? 'Prepare stock buys and sells for review. ' : ''}
          {requestsExecute
            ? 'If you grant chat trading below, Claude can execute trades within your active limits while this connection and delegation remain active.'
            : 'The agent cannot sign or submit a trade with this connection.'}
        </p>
        {requestsExecute && <label className="mt-5 flex items-start gap-3 text-sm">
          <input checked={allowExecute} className="mt-1" onChange={(event) => setAllowExecute(event.target.checked)} type="checkbox" />
          <span>I allow this Claude connection to execute trades within the limits I set in Oren. I can revoke it in settings.</span>
        </label>}
      </div>}
      {error && <p className="mt-5 text-sm text-red-700" role="alert">{error}</p>}
      {!auth.configured && <p className="mt-5 text-sm text-red-700" role="alert">Email sign-in is temporarily unavailable.</p>}
      {!auth.authenticated ? (
        <button className="mt-6 rounded-xl bg-foreground px-5 py-3 text-white disabled:opacity-50" disabled={!auth.configured || !auth.ready} onClick={auth.open} type="button">
          {auth.ready ? 'Sign in with email code' : 'Loading sign-in…'}
        </button>
      ) : (
        <button className="mt-6 rounded-xl bg-foreground px-5 py-3 text-white disabled:opacity-50" disabled={!details || !auth.address || busy || (requestsExecute && !allowExecute)} onClick={() => void authorize()} type="button">
          {busy ? 'Connecting…' : auth.address ? 'Allow connection' : 'Preparing your wallet…'}
        </button>
      )}
      <p className="mt-6 text-sm text-muted">
        You can revoke this connection anytime in <Link className="underline" href="/settings/mcp">Agent connections</Link>.
      </p>
    </main>
  );
}
