import { primaryButton, notice, field } from "./control-styles";
import { useState, type FormEvent } from "react";
import { post, setCsrfToken } from "./api";
import { useAuth } from "./state";
import { Icon } from "./ui";
import { ArrowRight } from "lucide-react";

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
    <div className="relative flex min-h-dvh items-center justify-center bg-white px-6 py-24">
      <a
        href="https://oren.finance"
        className="absolute top-6 left-7 flex items-center gap-2 text-lg font-semibold [&_img]:w-6"
      >
        <img src="/oren-mark.svg" alt="" />
        Oren Admin
      </a>
      <main className="w-full max-w-[330px]">
        <div className="[&_h2]:text-[25px] [&_h2]:font-semibold [&_h2]:tracking-tight [&>p]:mt-2 [&>p]:text-xs [&>p]:leading-relaxed [&>p]:text-muted [&_form]:mt-6 [&_form]:grid [&_form]:gap-4 [&_button]:w-full">
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
              <div className={notice} role="alert">
                {error || sessionError?.message}
              </div>
            )}
            {statusMessage && (
              <div className={notice} role="status">
                {statusMessage}
              </div>
            )}
            <button className={primaryButton} disabled={pending}>
              {pending ? "Please wait…" : changing ? "Set password" : "Sign in"}
              <Icon icon={ArrowRight} size={18} />
            </button>
          </form>
          <p className="mt-5! text-pretty">
            {changing
              ? "Your temporary password is single-use. If this session expires, ask your master admin for a replacement."
              : "Access is invitation only. Contact your master admin if you need an account or password recovery."}
          </p>
        </div>
      </main>
    </div>
  );
}
