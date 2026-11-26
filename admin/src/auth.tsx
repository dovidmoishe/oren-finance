import { primaryButton, inlineNotice, field } from "./control-styles";
import { useState, type FormEvent } from "react";
import { post, setCsrfToken } from "./api";
import { useAuth } from "./state";
import { ThemeControl } from "./theme-control";
import { Icon, IconChip } from "./ui";
import { ArrowRight, KeyRound, LockKeyhole } from "lucide-react";

export function AuthScreen({ changing = false }: { changing?: boolean }) {
  const { refresh, clear, error: sessionError } = useAuth();
  const [error, setError] = useState("");
  const [statusMessage, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    setError("");
    setPending(true);
    try {
      if (changing) {
        const nextPassword = String(fields.get("nextPassword"));
        if (nextPassword !== fields.get("confirmation"))
          throw new Error("Your new passwords don’t match.");
        await post("auth/password", {
          currentPassword: String(fields.get("password")),
          nextPassword,
        });
        form.reset();
        clear();
        setNotice("Password updated. Sign in with your new password.");
      } else {
        const login = await post<{ csrfToken: string }>("auth/session", {
          email: String(fields.get("email")),
          password: String(fields.get("password")),
        });
        setCsrfToken(login.csrfToken);
        form.reset();
        await refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in.");
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="relative flex min-h-dvh items-center justify-center bg-canvas px-4 py-24">
      <div className="absolute top-5 right-5">
        <ThemeControl compact />
      </div>
      <a
        href="https://oren.finance"
        className="absolute top-5 left-6 flex items-center gap-2.5 text-[17px] font-semibold tracking-tight [&_img]:size-7"
      >
        <img src="/oren-mark.svg" alt="" />
        Oren
        <span className="rounded-md bg-surface px-1.5 py-0.5 text-[11px] font-medium text-muted ring-1 ring-border ring-inset">
          Admin
        </span>
      </a>
      <main className="w-full max-w-[400px] rounded-2xl border border-border bg-surface p-8 shadow-card mobile:p-6">
        <div className="[&_h2]:mt-5 [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:tracking-tight [&>p]:mt-2 [&>p]:text-[13px] [&>p]:leading-relaxed [&>p]:text-muted [&_form]:mt-6 [&_form]:grid [&_form]:gap-4 [&_form>button]:w-full">
          <IconChip icon={changing ? KeyRound : LockKeyhole} />
          <h2>{changing ? "Set your password" : "Sign in"}</h2>
          <p>
            {changing
              ? "Replace your temporary password before entering the workspace."
              : "Sign in with your invited admin account."}
          </p>
          <form onSubmit={submit}>
            {!changing && (
              <label className="grid gap-1.5 text-xs font-medium">
                Email address
                <input
                  className={field}
                  name="email"
                  type="email"
                  autoComplete="username"
                  placeholder="you@oren.finance"
                  maxLength={200}
                  required
                />
              </label>
            )}
            <label className="grid gap-1.5 text-xs font-medium">
              {changing ? "Temporary password" : "Password"}
              <input
                className={field}
                name="password"
                type="password"
                autoComplete="current-password"
                required
                maxLength={200}
                minLength={12}
              />
            </label>
            {changing && (
              <>
                <label className="grid gap-1.5 text-xs font-medium">
                  New password
                  <input
                    className={field}
                    name="nextPassword"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={12}
                    maxLength={200}
                  />
                </label>
                <label className="grid gap-1.5 text-xs font-medium">
                  Confirm new password
                  <input
                    className={field}
                    name="confirmation"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={12}
                    maxLength={200}
                  />
                </label>
                <p className="text-xs leading-relaxed text-pretty text-muted">
                  Use 12–200 characters. You’ll sign in again after saving.
                </p>
              </>
            )}
            {(error || sessionError) && (
              <div className={inlineNotice} role="alert">
                {error || sessionError?.message}
              </div>
            )}
            {statusMessage && (
              <div className={inlineNotice} role="status">
                {statusMessage}
              </div>
            )}
            <button className={primaryButton} disabled={pending}>
              {pending ? "Please wait…" : changing ? "Set password" : "Sign in"}
              <Icon icon={ArrowRight} size={18} />
            </button>
          </form>
          <p className="mt-5! text-xs! text-pretty">
            {changing
              ? "Your temporary password is single-use. If this session expires, ask your master admin for a replacement."
              : "Access is invitation only. Contact your master admin if you need an account or password recovery."}
          </p>
        </div>
      </main>
    </div>
  );
}
