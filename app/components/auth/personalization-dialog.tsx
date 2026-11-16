"use client";

import { X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { EmailChoices, SectorChoices } from "@/components/settings/preference-fields";
import { Button } from "@/components/ui";
import { useT } from "@/i18n/i18n";
import { defaultPreferences, requestPreferences, sectorIds, type InterestId, type Preferences } from "@/services/preferences-service";

export function PersonalizationDialog({ getAccessToken, onFinish }: {
  getAccessToken: () => Promise<string | null>;
  onFinish: () => void;
}) {
  const t = useT();
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const request = useRef<AbortController | null>(null);
  const [step, setStep] = useState<"sectors" | "email">("sectors");
  const [draft, setDraft] = useState(defaultPreferences);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [availableInterests, setAvailableInterests] = useState<readonly InterestId[]>(sectorIds);

  useEffect(() => {
    const controller = new AbortController();
    void requestPreferences(getAccessToken, controller.signal).then(({ supportedInterests }) => {
      if (!controller.signal.aborted) setAvailableInterests(supportedInterests ?? sectorIds);
    }).catch(() => { /* Standard sectors remain available with older APIs. */ });
    return () => controller.abort();
  }, [getAccessToken]);

  useLayoutEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => {
      request.current?.abort();
      request.current = null;
      element?.close();
    };
  }, []);

  useEffect(() => heading.current?.focus(), [step]);

  function finish() {
    dialog.current?.close();
    onFinish();
  }

  async function save(preferences: Preferences) {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setDraft(preferences);
    setSaving(true);
    setFailed(false);
    try {
      await requestPreferences(getAccessToken, controller.signal, preferences);
      if (!controller.signal.aborted) finish();
    } catch {
      if (!controller.signal.aborted) setFailed(true);
    } finally {
      if (request.current === controller) request.current = null;
      if (!controller.signal.aborted) setSaving(false);
    }
  }

  return (
    <dialog
      aria-labelledby="personalization-title"
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-3xl border border-border bg-panel p-5 text-foreground shadow-xl backdrop:bg-black/30 sm:p-6"
      onCancel={(event) => {
        event.preventDefault();
        if (!request.current) finish();
      }}
      ref={dialog}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <h2 ref={heading} tabIndex={-1} id="personalization-title" className="font-display text-xl font-semibold">
          {t(step === "sectors" ? "preferences.followTitle" : "preferences.emailTitle")}
        </h2>
        <Button type="button" variant="ghost" size="icon" aria-label={t("common.close")} disabled={saving} onClick={finish}>
          <X size={18} aria-hidden="true" />
        </Button>
      </div>

      {step === "sectors" ? (
        <>
          <p className="mb-4 text-sm text-muted">{t("preferences.followDetail")}</p>
          <SectorChoices value={draft.sectors} availableInterests={availableInterests} onChange={(sectors) => setDraft({ ...draft, sectors })} />
          <div className="mt-6 flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => {
              setDraft({ ...draft, sectors: [] });
              setStep("email");
            }}>{t("preferences.skip")}</Button>
            <Button type="button" variant="primary" onClick={() => setStep("email")}>{t("preferences.continue")}</Button>
          </div>
        </>
      ) : (
        <>
          <fieldset disabled={saving}>
            <EmailChoices eligible value={draft} onChange={setDraft} />
          </fieldset>
          {failed && <p className="mt-3 text-sm text-negative" role="alert">{t("preferences.saveError")}</p>}
          <div className="mt-6 flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" disabled={saving} onClick={() => {
              setFailed(false);
              setStep("sectors");
            }}>{t("preferences.back")}</Button>
            {failed ? (
              <Button type="button" variant="secondary" onClick={finish}>{t("preferences.continueWithoutSaving")}</Button>
            ) : (
              <Button type="button" variant="secondary" disabled={saving} onClick={() =>
                void save({ ...draft, morningBrief: false, breakingNews: false })
              }>{t("preferences.skipEmails")}</Button>
            )}
            <Button type="button" variant="primary" disabled={saving} onClick={() => void save(draft)}>
              {t(saving ? "preferences.saving" : failed ? "preferences.retry" : "preferences.saveContinue")}
            </Button>
          </div>
        </>
      )}
    </dialog>
  );
}
