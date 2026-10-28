"use client";

import { Captcha, useLoginWithEmail } from "@privy-io/react-auth";
import { useEffect, useRef, useState, type FormEvent } from "react";

/** The enclosing dialog owns visibility; Privy owns OTP delivery and verification. */
export function EmailLogin({ onComplete }: { onComplete: () => void }) {
  const { sendCode, loginWithCode } = useLoginWithEmail();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const mounted = useRef(false);
  const pending = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  async function requestCode(event?: FormEvent) {
    event?.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await sendCode({ email: email.trim() });
      if (!mounted.current) return;
      setStep("code");
      setCode("");
    } catch (cause) {
      if (!mounted.current) return;
      setError(cause instanceof Error ? cause.message : "Unable to send a code. Please try again.");
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function verifyCode(event: FormEvent) {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await loginWithCode({ code: code.trim() });
      if (mounted.current) onComplete();
    } catch (cause) {
      if (!mounted.current) return;
      setError(cause instanceof Error ? cause.message : "Unable to verify the code. Please try again.");
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={step === "email" ? requestCode : verifyCode}>
      <Captcha />
      <div>
        <h2 className="text-xl font-semibold">{step === "email" ? "Sign in to Oren" : "Check your email"}</h2>
        <p className="mt-1 text-sm text-muted">{step === "email" ? "We’ll email you a one-time code." : `Enter the code sent to ${email}.`}</p>
      </div>
      {step === "email" ? (
        <label className="block text-sm font-medium">Email address
          <input autoComplete="email" autoFocus className="mt-2 w-full rounded-xl border border-border bg-white px-4 py-3 text-foreground" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} />
        </label>
      ) : (
        <label className="block text-sm font-medium">Verification code
          <input autoComplete="one-time-code" autoFocus className="mt-2 w-full rounded-xl border border-border bg-white px-4 py-3 text-foreground" inputMode="numeric" onChange={(event) => setCode(event.target.value)} required value={code} />
        </label>
      )}
      {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
      <button className="w-full rounded-xl bg-foreground px-4 py-3 text-sm font-medium text-white disabled:opacity-50" disabled={busy} type="submit">
        {busy ? "Please wait…" : step === "email" ? "Continue" : "Verify and sign in"}
      </button>
      {step === "code" && <div className="flex justify-between text-sm"><button disabled={busy} onClick={() => { setStep("email"); setError(undefined); }} type="button">Change email</button><button disabled={busy} onClick={() => void requestCode()} type="button">Resend code</button></div>}
    </form>
  );
}
