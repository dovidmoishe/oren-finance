'use client';

import { useEffect, useState } from 'react';
import { useOrenAuth } from '@/components/auth/auth-context';
import Link from 'next/link';
import Image from 'next/image';
import {
  ChevronRight as ChevronRightIcon,
  ChartLine as ChartLineIcon,
  Shield as ShieldIcon,
  Wallet as WalletIcon,
  Monitor as MonitorIcon,
} from "lucide-react";

import { OrenLogo } from '@/components/brand/oren-logo';
import { mcpApiOrigin } from '@/services/mcp-api-origin';
import { mcpConnector, mcpConnectorForKind } from '@/services/mcp-connector';
import { mcpEnrollmentLinks } from '@/services/mcp-enrollment-flow';
import { useI18n } from '@/i18n/i18n';
import { formatDateTime, formatNumber } from '@/components/ui';
import { consentAttributionHeader } from '@/components/growth/growth-collector';

type Interaction = {
  clientId: string;
  scope: string;
  resource: string;
  clientKind?: string;
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
  expiresAt?: string | null;
};

/** OAuth consent uses Oren's existing Privy sign-in dialog. */
export function McpConnect({ uid }: { uid: string }) {
  return <McpConnection key={uid} uid={uid} />;
}

function McpConnection({ uid }: { uid: string }) {
  const auth = useOrenAuth();
  const { locale, timeZone, t } = useI18n();
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
  const connector = mcpConnectorForKind(details?.clientKind) ?? mcpConnector(details?.callbackUrl);
  const appName = connector?.name ?? 'your app';
  const scopes = details?.scope.split(/\s+/) ?? [];
  const unavailable = !uid || !apiOrigin;
  const requiresEmbeddedWallet = authenticated && auth.walletKind !== 'embedded';

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
    if (!requestsExecute || !authenticated || requiresEmbeddedWallet || !apiOrigin) return;
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
  }, [requestsExecute, authenticated, requiresEmbeddedWallet, getAccessToken, apiOrigin]);

  async function resumeInteraction(response: Response) {
    const body = (await response.json()) as { redirect?: string };
    const redirect = new URL(body.redirect ?? '');
    if (redirect.origin !== apiOrigin || !redirect.pathname.startsWith('/oauth/'))
      throw new Error('Invalid authorization redirect.');
    window.location.assign(redirect.href);
  }

  async function refuse() {
    if (!apiOrigin || !uid) return;
    setBusy(true);
    try {
      const response = await fetch(`${apiOrigin}/oauth/interaction/${encodeURIComponent(uid)}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'X-Oren-Consent-Decision': 'deny', ...consentAttributionHeader() },
      });
      if (!response.ok) throw new Error();
      await resumeInteraction(response);
    } catch {
      setError('Unable to cancel this connection. Try again.');
      setBusy(false);
    }
  }

  async function authorize() {
    if (!apiOrigin || !uid || !details || !auth.authenticated || !auth.address || requiresEmbeddedWallet || (needsNativeConsent && !allowNativeClient) || (requestsExecute && (!allowExecute || !delegation?.enabled || !delegation.delegationId))) return;
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
          ...consentAttributionHeader(),
          ...(needsNativeConsent && allowNativeClient ? { 'X-Oren-Native-Client-Consent': 'true' } : {}),
          ...(requestsExecute ? { 'X-Oren-Trade-Execute-Consent': 'true', 'X-Oren-Delegation-Id': delegation!.delegationId! } : {}),
        },
      });
      if (!response.ok) throw new Error('Unable to authorize this connection. Start again in your agent.');
      await resumeInteraction(response);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to connect.');
      setBusy(false);
    }
  }

  return (
    <main className="mcp-connect-page">
      <section aria-labelledby="connection-title" className="mcp-connect-card">
        <div aria-hidden="true" className="flex items-center justify-center [gap:16px] [margin:0_0_28px]">
          <div className="mcp-connect-logo-tile"><OrenLogo size={52} /></div>
          <div className="mcp-connect-connector"><span /><span /><span /></div>
          <div className={`mcp-connect-logo-tile ${connector?.name === 'Claude' ? "mcp-connect-claude-tile" : ''}`}>
            {connector ? <Image alt="" src={connector.logo} width={37} height={37} /> : <MonitorIcon size={32} />}
          </div>
        </div>
        <header className="mcp-connect-heading">
          <h1 id="connection-title">{details ? `Connect Oren to ${appName}` : 'Connect to Oren'}</h1>
          {!auth.authenticated && <p>Sign in to continue.</p>}
        </header>
        {!details && !error && !unavailable && <p className="mcp-connect-loading" role="status">Loading your connection request…</p>}
        {details && <>
          <div className="[margin-top:26px] [padding-top:4px] [border-top:1px_solid_var(--border)]">
            {scopes.includes('oren.read') && <div className="mcp-connect-permission">
              <ChartLineIcon size={20} />
              <div><h3>View your portfolio and market data</h3></div>
            </div>}
            {scopes.includes('oren.trade.prepare') && <div className="mcp-connect-permission">
              <WalletIcon size={20} />
              <div><h3>Prepare trades for your review</h3></div>
            </div>}
            {requestsExecute && <div className="mcp-connect-permission">
              <ShieldIcon size={20} />
              <div><h3>Place trades within your limits</h3></div>
            </div>}
            {!requestsExecute && <p className="mcp-connect-review-note">Trades need your review and signature in Oren.</p>}
          </div>
          {needsNativeConsent ? <div className="mcp-connect-notice">
            <h2>Confirm your app</h2>
            <p>Oren cannot verify which local app receives access. Another app on your device could use this address.</p>
            <p className="[overflow-wrap:anywhere]">{details.callbackUrl}</p>
            <label className="mcp-connect-checkbox">
            <input checked={allowNativeClient} className="mt-1" onChange={(event) => setAllowNativeClient(event.target.checked)} type="checkbox" />
            <span>I started this connection from an app I trust on this device.</span>
            </label>
          </div> : <p className="mcp-connect-destination">Connecting to <strong>{details.callbackDestination}</strong></p>}
          {requestsExecute && delegation?.enabled && <div className="mcp-connect-notice">
            <h2>Your trading limits</h2>
            <dl className="mcp-connect-limits">
              <div><dt>Per trade</dt><dd>${delegation.perTradeUsd}</dd></div>
              <div><dt>Rolling 24 hours</dt><dd>${delegation.dailyUsd}</dd></div>
              <div><dt>Used in this window</dt><dd>${delegation.usedTodayUsd}</dd></div>
              <div><dt>Allowed trades</dt><dd>{delegation.sides?.join(' and ')}</dd></div>
              <div><dt>Price tolerance</dt><dd>{delegation.maxSlippageBps == null ? 'Unavailable' : `${formatNumber(delegation.maxSlippageBps / 100, locale, 2)}%`}</dd></div>
              <div><dt>Permission</dt><dd>{delegation.expiresAt === null ? t("grant.untilRevoked") : delegation.expiresAt ? formatDateTime(delegation.expiresAt, locale, timeZone, t("common.unknown")) : t("common.unknown")}</dd></div>
            </dl>
            <label className="mcp-connect-checkbox">
            <input checked={allowExecute} className="mt-1" onChange={(event) => setAllowExecute(event.target.checked)} type="checkbox" />
            <span>I allow {appName} to trade within these limits while this connection and trading permission are active.</span>
            </label>
          </div>}
          {requestsExecute && delegation && !delegation.enabled && <div className="mcp-connect-notice">
            <h2>Chat trading is off</h2>
            <p>Set your trading limits, then return here to finish connecting.</p>
            <Link className="mcp-connect-primary" href={`${mcpEnrollmentLinks(uid).settings}#chat-trading`}>Set up chat trading</Link>
          </div>}
          {requestsExecute && authenticated && !requiresEmbeddedWallet && !delegation && !delegationError && <p className="mcp-connect-loading" role="status">Checking your trading limits…</p>}
          <details className="mcp-connect-details">
            <summary>Connection details</summary>
            <dl><dt>Connection ID</dt><dd>{details.clientId}</dd><dt>Return address</dt><dd>{details.callbackUrl}</dd></dl>
          </details>
        </>}
      {unavailable && <p className="mcp-connect-error" role="alert">{!uid ? 'Open a new connection from your app to get started.' : 'Connections are temporarily unavailable. Please try again later.'}</p>}
      {error && <p className="mcp-connect-error" role="alert">{error}</p>}
      {delegationError && <p className="mcp-connect-error" role="alert">{delegationError}</p>}
      {requiresEmbeddedWallet && <div className="mcp-connect-notice" role="status"><p>{t('walletAuth.agentConnection')}</p><Link className="mcp-connect-primary" href={mcpEnrollmentLinks(uid).settings}>{t('nav.settings')}</Link></div>}
      {!auth.configured && <p className="mcp-connect-error" role="alert">Sign-in is temporarily unavailable.</p>}
      {!auth.authenticated ? (
        <button className="mcp-connect-primary" disabled={unavailable || !details || !auth.configured || !auth.ready} onClick={auth.open} type="button">
          {auth.ready ? 'Sign in to Oren' : 'Loading sign-in…'}
          <ChevronRightIcon size={18} />
        </button>
      ) : (
        <button className="mcp-connect-primary" disabled={unavailable || !details || !auth.address || requiresEmbeddedWallet || busy || (needsNativeConsent && !allowNativeClient) || (requestsExecute && (!allowExecute || !delegation?.enabled || !delegation.delegationId))} onClick={() => void authorize()} type="button">
          {busy ? 'Connecting…' : auth.address ? (connector ? `Connect to ${appName}` : 'Allow connection') : 'Getting your account ready…'}
          {!busy && <ChevronRightIcon size={18} />}
        </button>
      )}
      {details && <button className="mt-3 text-sm text-muted-foreground hover:text-foreground" disabled={busy} onClick={() => void refuse()} type="button">{t('common.cancel')}</button>}
      {!auth.authenticated && <p className="mcp-connect-sign-in-note">{t('walletAuth.optionalEmail')}</p>}
      </section>
      <p className="mcp-connect-footer">
        You can disconnect anytime in <Link href={mcpEnrollmentLinks(uid).settings}>Agent connections</Link>.
      </p>
    </main>
  );
}
