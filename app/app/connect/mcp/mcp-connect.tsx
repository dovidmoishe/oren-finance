'use client';

import { useEffect, useState } from 'react';
import { useOrenAuth } from '@/components/auth/auth-context';
import Link from 'next/link';

const configuredApi = process.env.NEXT_PUBLIC_OREN_API_URL;

type Interaction = { clientId: string; scope: string; resource: string };

/** OAuth consent uses Oren's existing Privy email OTP sign-in dialog. */
export function McpConnect({ uid }: { uid: string }) {
  const auth = useOrenAuth();
  const [details, setDetails] = useState<Interaction>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const apiOrigin = configuredApi ? new URL(configuredApi).origin : undefined;

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
    if (!apiOrigin || !uid || !details || !auth.authenticated || !auth.address) return;
    setBusy(true);
    setError(undefined);
    try {
      const token = await auth.getAccessToken();
      if (!token) throw new Error('Your session expired. Sign in again.');
      const response = await fetch(`${apiOrigin}/oauth/interaction/${encodeURIComponent(uid)}`, {
        method: 'POST',
        credentials: 'include',
        headers: { Authorization: `Bearer ${token}` },
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
          {details.scope.includes('oren.trade.prepare') ? 'Prepare a buy request and open Oren for your review and signature. ' : ''}
          The agent cannot sign or submit a trade with this connection.
        </p>
      </div>}
      {error && <p className="mt-5 text-sm text-red-700" role="alert">{error}</p>}
      {!auth.authenticated ? (
        <button className="mt-6 rounded-xl bg-foreground px-5 py-3 text-white disabled:opacity-50" disabled={!auth.ready} onClick={auth.open} type="button">
          Sign in with email code
        </button>
      ) : (
        <button className="mt-6 rounded-xl bg-foreground px-5 py-3 text-white disabled:opacity-50" disabled={!details || !auth.address || busy} onClick={() => void authorize()} type="button">
          {busy ? 'Connecting…' : auth.address ? 'Allow connection' : 'Preparing your wallet…'}
        </button>
      )}
      <p className="mt-6 text-sm text-muted">
        You can revoke this connection anytime in <Link className="underline" href="/settings/mcp">Agent connections</Link>.
      </p>
    </main>
  );
}
