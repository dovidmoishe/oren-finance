'use client';

import { useEffect, useState } from 'react';
import { useOrenAuth } from '@/components/auth/auth-context';
import Link from 'next/link';
import { mcpApiOrigin } from '@/services/mcp-api-origin';

type Interaction = {
  clientId: string;
  scope: string;
  resource: string;
  callbackUrl: string;
  callbackDestination: string;
  requiresNativeConsent: boolean;
};
type Delegation = {
  enabled: boolean;
  delegationId?: string;
  perTradeUsd?: string;
  dailyUsd?: string;
  usedTodayUsd?: string;
  maxSlippageBps?: number;
  sides?: string[];
  expiresAt?: string;
};

/** OAuth consent uses Oren's existing Privy email OTP sign-in dialog. */
export function McpConnect({ uid }: { uid: string }) {
  return <McpConnection key={uid} uid={uid} />;
}

function McpConnection({ uid }: { uid: string }) {
  const auth = useOrenAuth();
  const { authenticated, getAccessToken } = auth;
  const [details, setDetails] = useState<Interaction>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [allowExecute, setAllowExecute] = useState(false);
  const [allowNativeClient, setAllowNativeClient] = useState(false);
  const [delegation, setDelegation] = useState<Delegation>();
  const [delegationError, setDelegationError] = useState<string>();
  const apiOrigin = mcpApiOrigin();
  const requestsExecute = details?.scope.split(/\s+/).includes('oren.trade.execute') ?? false;
  const needsNativeConsent = details?.requiresNativeConsent === true;

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

  useEffect(() => {
    if (!requestsExecute || !authenticated || !apiOrigin) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const token = await getAccessToken();
        if (!token) throw new Error('Sign in again to view your trading limits.');
        const response = await fetch(`${apiOrigin}/mcp/delegation`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Unable to verify your chat trading permission.');
        const value = (await response.json()) as Delegation;
        if (!controller.signal.aborted) setDelegation(value);
      } catch {
        if (!controller.signal.aborted)
          setDelegationError('Unable to verify your chat trading permission.');
      }
    })();
    return () => controller.abort();
  }, [requestsExecute, authenticated, getAccessToken, apiOrigin]);

  async function authorize() {
    if (!apiOrigin || !uid || !details || !auth.authenticated || !auth.address || (needsNativeConsent && !allowNativeClient) || (requestsExecute && (!allowExecute || !delegation?.enabled || !delegation.delegationId))) return;
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
          ...(needsNativeConsent && allowNativeClient ? { 'X-Oren-Native-Client-Consent': 'true' } : {}),
          ...(requestsExecute ? { 'X-Oren-Trade-Execute-Consent': 'true', 'X-Oren-Delegation-Id': delegation!.delegationId! } : {}),
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
        <p className="text-sm text-muted">Connection ID</p>
        <p className="mt-1 break-all font-medium">{details.clientId}</p>
        <p className="mt-5 text-sm text-muted">Return to</p>
        <p className="mt-1 break-all font-medium">{details.callbackDestination}</p>
        <p className="mt-1 break-all text-xs text-muted">{details.callbackUrl}</p>
        {needsNativeConsent && <div className="mt-5 rounded-xl border border-border p-4">
          <p className="text-sm font-medium">Confirm the app you opened</p>
          <p className="mt-2 text-sm text-muted">This callback returns access to a local app. Oren cannot verify that it is Cursor or Codex. Another program on your device can use the same callback.</p>
          <label className="mt-4 flex items-start gap-3 text-sm">
            <input checked={allowNativeClient} className="mt-1" onChange={(event) => setAllowNativeClient(event.target.checked)} type="checkbox" />
            <span>I started this connection from an app I trust on this device.</span>
          </label>
        </div>}
        <p className="mt-5 text-sm text-muted">Access requested</p>
        <p className="mt-1">
          {details.scope.includes('oren.read') ? 'Read your portfolio and stock market data. ' : ''}
          {details.scope.includes('oren.trade.prepare') ? 'Prepare stock buys and sells for review. ' : ''}
          {requestsExecute
            ? 'If you grant chat trading below, your agent app can execute trades within your active limits while this connection and delegation remain active.'
            : 'The agent cannot sign or submit a trade with this connection.'}
        </p>
        {requestsExecute && delegation?.enabled && <>
          <p className="mt-5 text-sm">Up to ${delegation.perTradeUsd} per trade and ${delegation.dailyUsd} in any rolling 24 hours. Used: ${delegation.usedTodayUsd}. {delegation.sides?.join(' and ')} only. Maximum slippage: {delegation.maxSlippageBps} bps. Expires {delegation.expiresAt ? new Date(delegation.expiresAt).toLocaleString() : 'soon'}.</p>
          <label className="mt-4 flex items-start gap-3 text-sm">
            <input checked={allowExecute} className="mt-1" onChange={(event) => setAllowExecute(event.target.checked)} type="checkbox" />
            <span>I allow this agent connection to execute trades within these limits. I can revoke it in settings.</span>
          </label>
        </>}
        {requestsExecute && delegation && !delegation.enabled && <p className="mt-5 text-sm">Chat trading is not active. Enable it in <Link className="underline" href="/app/settings/connections">Agent connections</Link> before connecting your agent app.</p>}
      </div>}
      {error && <p className="mt-5 text-sm text-red-700" role="alert">{error}</p>}
      {delegationError && <p className="mt-5 text-sm text-red-700" role="alert">{delegationError}</p>}
      {!auth.configured && <p className="mt-5 text-sm text-red-700" role="alert">Email sign-in is temporarily unavailable.</p>}
      {!auth.authenticated ? (
        <button className="mt-6 rounded-xl bg-foreground px-5 py-3 text-white disabled:opacity-50" disabled={!auth.configured || !auth.ready} onClick={auth.open} type="button">
          {auth.ready ? 'Sign in with email code' : 'Loading sign-in…'}
        </button>
      ) : (
        <button className="mt-6 rounded-xl bg-foreground px-5 py-3 text-white disabled:opacity-50" disabled={!details || !auth.address || busy || (needsNativeConsent && !allowNativeClient) || (requestsExecute && (!allowExecute || !delegation?.enabled || !delegation.delegationId))} onClick={() => void authorize()} type="button">
          {busy ? 'Connecting…' : auth.address ? 'Allow connection' : 'Preparing your wallet…'}
        </button>
      )}
      <p className="mt-6 text-sm text-muted">
        You can revoke this connection anytime in <Link className="underline" href="/app/settings/connections">Agent connections</Link>.
      </p>
    </main>
  );
}
