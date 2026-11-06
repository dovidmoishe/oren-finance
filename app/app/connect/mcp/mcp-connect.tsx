'use client';

import { useEffect, useState } from 'react';
import { useOrenAuth } from '@/components/auth/auth-context';
import Link from 'next/link';
import Image from 'next/image';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowRight01Icon, ChartLineData01Icon, Shield01Icon, Wallet01Icon, ComputerIcon } from '@hugeicons/core-free-icons';
import { OrenLogo } from '@/components/brand/oren-logo';
import styles from './mcp-connect.module.css';
import { mcpApiOrigin } from '@/services/mcp-api-origin';
import { mcpConnector } from '@/services/mcp-connector';

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
  const connector = mcpConnector(details?.callbackUrl);
  const appName = connector?.name ?? 'your app';
  const scopes = details?.scope.split(/\s+/) ?? [];
  const unavailable = !uid || !apiOrigin;

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
    <main className={styles.page}>
      <section aria-labelledby="connection-title" className={styles.card}>
        <div aria-hidden="true" className={styles.brands}>
          <div className={styles.logoTile}><OrenLogo size={52} /></div>
          <div className={styles.connector}><span /><span /><span /></div>
          <div className={`${styles.logoTile} ${connector?.name === 'Claude' ? styles.claudeTile : ''}`}>
            {connector ? <Image alt="" src={connector.logo} width={37} height={37} /> : <HugeiconsIcon icon={ComputerIcon} size={32} />}
          </div>
        </div>
        <header className={styles.heading}>
          <h1 id="connection-title">{details ? `Connect Oren to ${appName}` : 'Connect to Oren'}</h1>
          {!auth.authenticated && <p>Sign in to continue.</p>}
        </header>
        {!details && !error && !unavailable && <p className={styles.loading} role="status">Loading your connection request…</p>}
        {details && <>
          <div className={styles.permissions}>
            {scopes.includes('oren.read') && <div className={styles.permission}>
              <HugeiconsIcon icon={ChartLineData01Icon} size={20} />
              <div><h3>View your portfolio and market data</h3></div>
            </div>}
            {scopes.includes('oren.trade.prepare') && <div className={styles.permission}>
              <HugeiconsIcon icon={Wallet01Icon} size={20} />
              <div><h3>Prepare trades for your review</h3></div>
            </div>}
            {requestsExecute && <div className={styles.permission}>
              <HugeiconsIcon icon={Shield01Icon} size={20} />
              <div><h3>Place trades within your limits</h3></div>
            </div>}
            {!requestsExecute && <p className={styles.reviewNote}>Trades need your review and signature in Oren.</p>}
          </div>
          {needsNativeConsent ? <div className={styles.notice}>
            <h2>Confirm your app</h2>
            <p>Oren cannot verify which local app receives access. Another app on your device could use this address.</p>
            <p className={styles.callback}>{details.callbackUrl}</p>
            <label className={styles.checkbox}>
            <input checked={allowNativeClient} className="mt-1" onChange={(event) => setAllowNativeClient(event.target.checked)} type="checkbox" />
            <span>I started this connection from an app I trust on this device.</span>
            </label>
          </div> : <p className={styles.destination}>Connecting to <strong>{details.callbackDestination}</strong></p>}
          {requestsExecute && delegation?.enabled && <div className={styles.notice}>
            <h2>Your trading limits</h2>
            <dl className={styles.limits}>
              <div><dt>Per trade</dt><dd>${delegation.perTradeUsd}</dd></div>
              <div><dt>Rolling 24 hours</dt><dd>${delegation.dailyUsd}</dd></div>
              <div><dt>Used in this window</dt><dd>${delegation.usedTodayUsd}</dd></div>
              <div><dt>Allowed trades</dt><dd>{delegation.sides?.join(' and ')}</dd></div>
              <div><dt>Price tolerance</dt><dd>{delegation.maxSlippageBps == null ? 'Unavailable' : `${delegation.maxSlippageBps / 100}%`}</dd></div>
              <div><dt>Expires</dt><dd>{delegation.expiresAt ? new Date(delegation.expiresAt).toLocaleString() : 'soon'}</dd></div>
            </dl>
            <label className={styles.checkbox}>
            <input checked={allowExecute} className="mt-1" onChange={(event) => setAllowExecute(event.target.checked)} type="checkbox" />
            <span>I allow {appName} to trade within these limits while this connection and trading permission are active.</span>
            </label>
          </div>}
          {requestsExecute && delegation && !delegation.enabled && <div className={styles.notice}>
            <h2>Chat trading is off</h2>
            <p>Set your limits in <Link href="/settings/mcp">Agent connections</Link>, then reconnect.</p>
          </div>}
          {requestsExecute && authenticated && !delegation && !delegationError && <p className={styles.loading} role="status">Checking your trading limits…</p>}
          <details className={styles.details}>
            <summary>Connection details</summary>
            <dl><dt>Connection ID</dt><dd>{details.clientId}</dd><dt>Return address</dt><dd>{details.callbackUrl}</dd></dl>
          </details>
        </>}
      {unavailable && <p className={styles.error} role="alert">{!uid ? 'Open a new connection from your app to get started.' : 'Connections are temporarily unavailable. Please try again later.'}</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {delegationError && <p className={styles.error} role="alert">{delegationError}</p>}
      {!auth.configured && <p className={styles.error} role="alert">Email sign-in is temporarily unavailable.</p>}
      {!auth.authenticated ? (
        <button className={styles.primary} disabled={unavailable || !details || !auth.configured || !auth.ready} onClick={auth.open} type="button">
          {auth.ready ? 'Sign in to Oren' : 'Loading sign-in…'}
          <HugeiconsIcon icon={ArrowRight01Icon} size={18} />
        </button>
      ) : (
        <button className={styles.primary} disabled={unavailable || !details || !auth.address || busy || (needsNativeConsent && !allowNativeClient) || (requestsExecute && (!allowExecute || !delegation?.enabled || !delegation.delegationId))} onClick={() => void authorize()} type="button">
          {busy ? 'Connecting…' : auth.address ? (connector ? `Connect to ${appName}` : 'Allow connection') : 'Getting your account ready…'}
          {!busy && <HugeiconsIcon icon={ArrowRight01Icon} size={18} />}
        </button>
      )}
      {!auth.authenticated && <p className={styles.signInNote}>We’ll email you a sign-in code.</p>}
      </section>
      <p className={styles.footer}>
        You can disconnect anytime in <Link href="/settings/mcp">Agent connections</Link>.
      </p>
    </main>
  );
}
