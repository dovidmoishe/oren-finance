"use client";

import { useOrenAuth } from "@/components/auth/auth-context";
import { RestoreActions, restoreBlocked } from "@/components/auth/restore-actions";
import { LanguageMenu } from "@/components/language/language-menu";
import { Button } from "@/components/ui";
import { useI18n } from "@/i18n/i18n";
import { LOCALES } from "@/i18n/locales";

export function AccountSettings() {
  const auth = useOrenAuth();
  const { locale, t } = useI18n();
  return (
    <section aria-labelledby="settings-account-title" className="space-y-5">
      <div>
        <h2 className="font-display text-xl font-semibold" id="settings-account-title">{t("settings.account")}</h2>
        <p className="mt-1 text-sm leading-6 text-muted">{t("settings.accountDetail")}</p>
      </div>
      <div className="overflow-hidden rounded-2xl border border-border">
        {restoreBlocked(auth) ? (
          <div className="space-y-3 p-5"><p className="text-sm text-muted">{t("auth.restoreSlow")}</p><RestoreActions signInLabel={t("account.signIn")} /></div>
        ) : !auth.ready ? (
          <p className="p-5 text-sm text-muted" role="status">{t("account.loading")}</p>
        ) : auth.authenticated ? (
          <dl className="divide-y divide-border">
            <div className="grid gap-2 p-5 @lg:grid-cols-[8rem_minmax(0,1fr)]">
              <dt className="text-sm text-muted">{t("auth.emailLabel")}</dt>
              <dd className="min-w-0 text-sm"><p className="break-all font-medium">{auth.email || t('walletAuth.noEmail')}</p>{!auth.email && <><p className="mt-1 leading-6 text-muted">{t('walletAuth.emailDetail')}</p><Button className="mt-3" size="sm" disabled={auth.busy} onClick={auth.linkEmail}>{t('walletAuth.addEmail')}</Button></>}</dd>
            </div>
            <div className="grid gap-2 p-5 @lg:grid-cols-[8rem_minmax(0,1fr)]">
              <dt className="text-sm text-muted">{t("connections.wallet")}</dt>
              <dd className="min-w-0">
                {auth.wallets.length > 1 ? (
                  <select aria-label={t("connections.wallet")} className="w-full min-w-0 rounded-lg border border-border bg-panel px-3 py-2 text-sm" disabled={auth.busy} id="settings-wallet" onChange={(event) => auth.selectWallet(event.target.value)} value={auth.address ?? ""}>
                    {!auth.address && <option value="" disabled>{t("settings.walletPending")}</option>}
                    {auth.wallets.map((wallet) => <option key={wallet.address} value={wallet.address}>{wallet.label} · {wallet.address}</option>)}
                  </select>
                ) : <p className="break-all text-sm font-medium">{auth.address || t("settings.walletPending")}</p>}
                {auth.walletKind === 'external' && <p className="mt-2 text-xs leading-5 text-muted">{t('walletAuth.approvalDetail')}</p>}
                {auth.walletKind === 'external' && !auth.walletConnected && <Button className="mt-3" size="sm" disabled={auth.busy} onClick={auth.connectWallet}>{t('walletAuth.reconnect')}</Button>}
                <Button className="mt-3" size="sm" disabled={auth.busy} onClick={auth.linkWallet}>{t('walletAuth.addWallet')}</Button>
              </dd>
            </div>
          </dl>
        ) : (
          <div className="space-y-3 p-5"><p className="text-sm text-muted">{t("settings.signInDetail")}</p><Button disabled={!auth.configured} onClick={auth.open} type="button">{t("account.signIn")}</Button></div>
        )}
        <div className="flex items-center justify-between gap-4 border-t border-border p-5">
          <div><p className="text-sm font-medium">{t("language.title")}</p><p className="mt-1 text-sm text-muted">{LOCALES.find(({ code }) => code === locale)?.name}</p></div>
          <LanguageMenu />
        </div>
      </div>
      {auth.authenticated && <Button disabled={auth.busy} onClick={() => void auth.signOut()} type="button" variant="secondary">{t("account.signOut")}</Button>}
      {auth.error && <p className="text-sm text-negative" role="alert">{auth.error}</p>}
    </section>
  );
}
