import { useState, type FormEvent } from "react";
import { post, setCsrfToken } from "./api";
import { useAuth } from "./state";
import { Icon } from "./ui";
import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";

export function AuthScreen({ changing = false }: { changing?: boolean }) {
  const { refresh, clear, error: sessionError } = useAuth();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
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
    <div className="auth-page">
      <a href="https://oren.finance" className="auth-brand">
        <img src="/oren-mark.svg" alt="" />
        Oren Admin
      </a>
      <main className="auth-main">
        <div className="auth-card">
          <h2>{changing ? "Set your password" : "Sign in"}</h2>
          <p>
            {changing
              ? "Replace your temporary password before entering the workspace."
              : "Sign in with your invited admin account."}
          </p>
          <form onSubmit={submit}>
            {!changing && (
              <label>
                Email address
                <input
                  name="email"
                  type="email"
                  autoComplete="username"
                  placeholder="you@oren.finance"
                  maxLength={200}
                  required
                />
              </label>
            )}
            <label>
              {changing ? "Temporary password" : "Password"}
              <input
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
                <label>
                  New password
                  <input
                    name="nextPassword"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={12}
                    maxLength={200}
                  />
                </label>
                <label>
                  Confirm new password
                  <input
                    name="confirmation"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={12}
                    maxLength={200}
                  />
                </label>
                <p className="form-help">
                  Use 12–200 characters. You’ll sign in again after saving.
                </p>
              </>
            )}
            {(error || sessionError) && (
              <div className="notice error" role="alert">
                {error || sessionError?.message}
              </div>
            )}
            {notice && (
              <div className="notice success" role="status">
                {notice}
              </div>
            )}
            <button className="primary" disabled={pending}>
              {pending ? "Please wait…" : changing ? "Set password" : "Sign in"}
              <Icon icon={ArrowRight01Icon} size={18} />
            </button>
          </form>
          <p className="auth-help">
            {changing
              ? "Your temporary password is single-use. If this session expires, ask your master admin for a replacement."
              : "Access is invitation only. Contact your master admin if you need an account or password recovery."}
          </p>
        </div>
        <span className="auth-bottom">Oren Finance · Admin workspace</span>
      </main>
    </div>
  );
}
