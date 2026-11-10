'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useOrenAuth } from '@/components/auth/auth-context';
import { Button } from '@/components/ui';
import { mcpApiOrigin } from '@/services/mcp-api-origin';
import { useI18n } from '@/i18n/i18n';

type Preference = { enabled: boolean; emailAvailable: boolean; ready: boolean };

export function TradeEmailPreferences() {
  const auth = useOrenAuth();
  return (
    <TradeEmailPreferencesContent
      key={`${auth.ready}:${auth.authenticated}:${auth.address ?? ''}`}
    />
  );
}

function TradeEmailPreferencesContent() {
  const {
    ready: authReady,
    authenticated,
    configured,
    address,
    email,
    getAccessToken,
    open,
  } = useOrenAuth();
  const apiOrigin = mcpApiOrigin();
  const { t } = useI18n();
  const [preference, setPreference] = useState<Preference>();
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  useEffect(() => {
    if (!authReady || !authenticated || !address || !apiOrigin) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    void (async () => {
      try {
        const token = await getAccessToken();
        if (!token) throw new Error(t('tradeEmail.loadFailed'));
        const response = await fetch(preferenceUrl(apiOrigin, address), {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(t('tradeEmail.loadFailed'));
        const result = (await response.json()) as Preference;
        if (!controller.signal.aborted) {
          setPreference(result);
          setEnabled(result.enabled);
        }
      } catch {
        if (!controller.signal.aborted) setError(t('tradeEmail.loadFailed'));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
    // Copy changes affect labels only; they should not refetch account settings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady, authenticated, address, apiOrigin, getAccessToken]);

  async function save() {
    if (!apiOrigin || !address || busy) return;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error(t('tradeEmail.saveFailed'));
      const response = await fetch(preferenceUrl(apiOrigin, address), {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ enabled }),
      });
      if (!response.ok) throw new Error(t('tradeEmail.saveFailed'));
      const result = (await response.json()) as Preference;
      setPreference(result);
      setEnabled(result.enabled);
      setNotice(t('tradeEmail.saved'));
    } catch {
      setError(t('tradeEmail.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  const canSave =
    Boolean(preference) &&
    enabled !== preference?.enabled &&
    (!enabled || Boolean(preference?.ready));

  return (
    <main className="mx-auto max-w-3xl pb-16 pt-3 sm:pt-7">
      <Link
        href="/app"
        className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground"
      >
        <HugeiconsIcon icon={ArrowLeft01Icon} size={16} aria-hidden="true" />
        {t('tradeEmail.back')}
      </Link>
      <header className="mb-8 mt-7">
        <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          {t('tradeEmail.title')}
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted">
          {t('tradeEmail.intro')}
        </p>
      </header>

      {!authReady ? (
        <p className="rounded-2xl border border-border bg-panel p-6 text-sm text-muted" role="status">
          {t('tradeEmail.loading')}
        </p>
      ) : !authenticated ? (
        <section className="rounded-2xl border border-border bg-panel p-6 sm:p-8">
          <p className="text-sm leading-relaxed text-muted">{t('tradeEmail.signIn')}</p>
          <Button className="mt-5" variant="primary" onClick={open} disabled={!configured}>
            {t('account.signIn')}
          </Button>
        </section>
      ) : loading ? (
        <p className="rounded-2xl border border-border bg-panel p-6 text-sm text-muted" role="status">
          {t('tradeEmail.loading')}
        </p>
      ) : !apiOrigin || error && !preference ? (
        <p className="rounded-2xl border border-border bg-panel p-6 text-sm text-red-700" role="alert">
          {error ?? t('tradeEmail.loadFailed')}
        </p>
      ) : preference ? (
        <section className="rounded-2xl border border-border bg-panel p-5 sm:p-7">
          <h2 className="text-lg font-semibold">{t('tradeEmail.heading')}</h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
            {t('tradeEmail.body')}
          </p>
          <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-background p-4">
            <input
              className="mt-1 size-4 accent-[#6259e8]"
              type="checkbox"
              checked={enabled}
              disabled={busy || (!preference.ready && !enabled)}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            <span>
              <span className="block text-sm font-medium">{t('tradeEmail.enabled')}</span>
              {email && (
                <span className="mt-1 block break-all text-xs text-muted">
                  {t('tradeEmail.sendTo', { email })}
                </span>
              )}
            </span>
          </label>
          {!preference.emailAvailable && (
            <p className="mt-4 text-sm text-muted">{t('tradeEmail.noEmail')}</p>
          )}
          {preference.emailAvailable && !preference.ready && (
            <p className="mt-4 text-sm text-muted">{t('tradeEmail.unavailable')}</p>
          )}
          <Button className="mt-5" disabled={!canSave || busy} onClick={() => void save()}>
            {busy ? t('tradeEmail.saving') : t('tradeEmail.save')}
          </Button>
          {error && <p className="mt-4 text-sm text-red-700" role="alert">{error}</p>}
          {notice && <p className="mt-4 text-sm text-foreground" role="status">{notice}</p>}
        </section>
      ) : null}
    </main>
  );
}

function preferenceUrl(apiOrigin: string, wallet: string): string {
  return `${apiOrigin}/api/notifications/trade-email?walletAddress=${encodeURIComponent(wallet)}`;
}
