"use client";

import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { useOrenAuth } from "@/components/auth/auth-context";
import { RestoreActions, restoreBlocked } from "@/components/auth/restore-actions";
import { Button } from "@/components/ui";
import { useT } from "@/i18n/i18n";
import { defaultPreferences, requestPreferences, sectorIds, type InterestId, type Preferences } from "@/services/preferences-service";
import { EmailChoices, SectorChoices } from "./preference-fields";

export function PreferencesSettings() {
  const auth = useOrenAuth();
  const t = useT();
  return (
    <section aria-labelledby="settings-preferences-title" className="space-y-4">
      <div><h2 className="font-display text-xl font-semibold" id="settings-preferences-title">{t("preferences.title")}</h2><p className="mt-1 text-sm leading-6 text-muted">{t("preferences.followDetail")}</p></div>
      <div className="rounded-2xl border border-border p-4 @lg:p-5">
        {restoreBlocked(auth) ? <RestoreActions signInLabel={t("account.signIn")} /> : !auth.ready ? (
          <p role="status">{t("account.loading")}</p>
        ) : auth.authenticated && auth.userId ? (
          <><PreferencesForm key={`${auth.userId}:${auth.email ?? ''}`} getAccessToken={auth.getAccessToken} />{!auth.email && <Button className="mt-4" size="sm" disabled={auth.busy} onClick={auth.linkEmail}>{t('walletAuth.addEmail')}</Button>}</>
        ) : (
          <Button type="button" variant="primary" disabled={!auth.configured} onClick={auth.open}>{t("account.signIn")}</Button>
        )}
      </div>
    </section>
  );
}

function PreferencesForm({ getAccessToken }: {
  getAccessToken: () => Promise<string | null>;
}) {
  const t = useT();
  const [draft, setDraft] = useState<Preferences>();
  const [eligible, setEligible] = useState(false);
  const [availableInterests, setAvailableInterests] = useState<readonly InterestId[]>(sectorIds);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const request = useRef<AbortController | null>(null);
  const tokenProvider = useRef(getAccessToken);
  useLayoutEffect(() => { tokenProvider.current = getAccessToken; }, [getAccessToken]);
  useLayoutEffect(() => () => request.current?.abort(), []);

  useEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    void requestPreferences(tokenProvider.current, controller.signal).then(({ preferences, emailEligible, supportedInterests }) => {
      if (controller.signal.aborted) return;
      setDraft(preferences ?? defaultPreferences());
      setEligible(emailEligible);
      setAvailableInterests(supportedInterests ?? sectorIds);
    }).catch(() => {
      if (!controller.signal.aborted) setLoadFailed(true);
    }).finally(() => {
      if (request.current === controller) request.current = null;
    });
    return () => controller.abort();
  }, [loadAttempt]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setStatus("saving");
    try {
      const { preferences, emailEligible } = await requestPreferences(tokenProvider.current, controller.signal, {
        ...draft,
        morningBrief: eligible && draft.morningBrief,
        breakingNews: eligible && draft.breakingNews,
        timeZone: draft.timeZone.trim(),
      });
      if (controller.signal.aborted) return;
      if (preferences) setDraft(preferences);
      setEligible(emailEligible);
      setStatus("saved");
    } catch {
      if (!controller.signal.aborted) setStatus("error");
    } finally {
      if (request.current === controller) request.current = null;
    }
  }

  if (!draft) {
    return loadFailed ? (
      <div className="space-y-3">
        <p role="alert" className="text-negative">{t("preferences.loadError")}</p>
        <Button type="button" variant="secondary" onClick={() => {
          setLoadFailed(false);
          setLoadAttempt((attempt) => attempt + 1);
        }}>{t("preferences.retry")}</Button>
      </div>
    ) : <p role="status">{t("account.loading")}</p>;
  }

  function edit(next: Preferences) {
    setDraft(next);
    setStatus("idle");
  }

  const inputClass = "mt-1 block w-full rounded-xl border border-border bg-background px-3 py-2 text-sm";
  return (
    <form onSubmit={save}>
      <fieldset disabled={status === "saving"} className="space-y-5">
        <fieldset className="space-y-2">
          <legend className="font-semibold">{t("preferences.followTitle")}</legend>
          <SectorChoices value={draft.sectors} availableInterests={availableInterests} onChange={(sectors) => edit({ ...draft, sectors })} />
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="font-semibold">{t("preferences.emailTitle")}</legend>
          <EmailChoices value={draft} onChange={edit} eligible={eligible} />
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium">
            {t("preferences.briefTime")}
            <input className={inputClass} type="time" value={draft.briefTime} required onChange={(event) =>
              edit({ ...draft, briefTime: event.target.value })
            } />
          </label>
          <label className="text-sm font-medium">
            {t("preferences.timeZone")}
            <input
              className={inputClass}
              list="brief-time-zones"
              value={draft.timeZone}
              required
              maxLength={80}
              placeholder="America/New_York"
              onChange={(event) => edit({ ...draft, timeZone: event.target.value })}
            />
            <datalist id="brief-time-zones">
              <option value="UTC" />
              {Intl.supportedValuesOf?.("timeZone").map((zone) => <option key={zone} value={zone} />)}
            </datalist>
          </label>
        </div>
        <Button type="submit" variant="primary">{t(status === "saving" ? "preferences.saving" : "preferences.save")}</Button>
      </fieldset>
      {status === "saved" && <p className="mt-3 text-sm" role="status">{t("preferences.saved")}</p>}
      {status === "error" && <p className="mt-3 text-sm text-negative" role="alert">{t("preferences.saveError")}</p>}
    </form>
  );
}
