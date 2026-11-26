import {
  primaryButton,
  button,
  dangerButton,
  iconButton,
  quietButton,
  tableScroll,
  inlineNotice,
  field,
} from "./control-styles";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X, Copy, Users, LockKeyhole } from "lucide-react";
import { api, post } from "./api";
import { useAuth } from "./state";
import type { Account, Permission, TemporaryCredential } from "./types";
import {
  Badge,
  DateTime,
  Empty,
  ErrorState,
  Icon,
  Loading,
  Panel,
  PermissionDenied,
  Status,
} from "./ui";

const permissionOption =
  "flex cursor-pointer items-start gap-3 rounded-xl border border-border p-3.5 text-xs transition-colors hover:bg-panel has-checked:border-brand/60 has-checked:bg-brand/5 [&_input]:mt-0.5 [&_input]:size-4 [&_input]:accent-brand [&_strong]:block [&_strong]:text-[13px] [&_strong]:font-medium [&_small]:mt-1 [&_small]:block [&_small]:text-muted";

function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="m-auto max-h-[90dvh] w-[min(460px,calc(100%-2rem))] overflow-y-auto rounded-2xl border border-border bg-surface p-6 text-foreground shadow-pop backdrop:bg-black/40 backdrop:backdrop-blur-[2px] [&_form]:grid [&_form]:gap-4 [&_fieldset]:grid [&_fieldset]:gap-2 [&_legend]:mb-2 [&_legend]:text-xs [&_legend]:font-medium"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      aria-labelledby="modal-title"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <h2 id="modal-title" className="pt-1.5 text-base font-semibold tracking-tight">
          {title}
        </h2>
        <button
          className={iconButton}
          aria-label="Close dialog"
          onClick={close}
        >
          <Icon icon={X} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export function AccountsPage() {
  const { session } = useAuth();
  const client = useQueryClient();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<Account | null>(null);
  const [credential, setCredential] = useState<TemporaryCredential | null>(
    null,
  );
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const query = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api<Account[]>("auth/accounts"),
    enabled: !!session?.isMaster,
  });
  const mutation = useMutation({
    gcTime: 0,
    mutationFn: async (input: {
      action: "invite" | "rotate" | "revoke";
      account?: Account;
      email?: string;
      permissions?: Permission[];
    }) => {
      if (input.action === "invite")
        return post<TemporaryCredential>("auth/accounts", {
          email: input.email,
          permissions: input.permissions,
        });
      if (input.action === "rotate")
        return {
          ...(await post<TemporaryCredential>(
            `auth/accounts/${input.account!.id}/temporary-password`,
          )),
          email: input.account!.email,
        };
      await post(`auth/accounts/${input.account!.id}/revoke`);
      return null;
    },
    onSuccess: (result) => {
      setInviteOpen(false);
      setRevokeTarget(null);
      if (result) {
        setCopied(false);
        setCopyError("");
        setCredential(result);
      }
      void client.invalidateQueries({ queryKey: ["accounts"] });
      void client.invalidateQueries({ queryKey: ["operations", "audit"] });
    },
  });
  if (!session?.isMaster)
    return <PermissionDenied permission="master-admin access" />;
  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const permissions = form.getAll("permissions") as Permission[];
    mutation.mutate({
      action: "invite",
      email: String(form.get("email")),
      permissions,
    });
  }
  return (
    <>
      <Panel
        title="Admin accounts"
        subtitle="Invite-only access to this workspace"
        icon={Users}
        action={
          <button
            className={primaryButton}
            onClick={() => {
              mutation.reset();
              setInviteOpen(true);
            }}
          >
            <Icon icon={Plus} size={16} />
            Invite admin
          </button>
        }
      >
        {query.isPending ? (
          <Loading />
        ) : query.error ? (
          <ErrorState
            className="mx-5 mb-5"
            error={query.error}
            retry={() => void query.refetch()}
          />
        ) : query.data.length === 0 ? (
          <Empty title="No admin accounts returned" icon={Users} />
        ) : (
          <div className={tableScroll}>
            <table>
              <thead>
                <tr>
                  <th>Team member</th>
                  <th>Role</th>
                  <th>Permissions</th>
                  <th>Status</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {query.data.map((account) => (
                  <tr key={account.id}>
                    <td>
                      <div className="flex items-center gap-3">
                        <span
                          className="grid size-9 shrink-0 place-items-center rounded-full bg-brand/12 text-[13px] font-semibold text-brand"
                          aria-hidden="true"
                        >
                          {account.email.charAt(0).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <span className="block truncate font-medium">
                            {account.email}
                          </span>
                          {account.id === session.id && (
                            <span className="mt-0.5 block text-[11px] text-muted">
                              You
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td>
                      <Badge tone={account.isMaster ? "brand" : ""}>
                        {account.isMaster ? "Master admin" : "Admin"}
                      </Badge>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {account.permissions.map((permission) => (
                          <Badge key={permission}>{permission}</Badge>
                        ))}
                      </div>
                    </td>
                    <td>
                      <Status value={account.status} />
                      {account.mustChangePassword &&
                        account.status !== "revoked" && (
                          <span className="mt-1 block max-w-60 truncate text-[11px] text-muted">
                            Password replacement required
                          </span>
                        )}
                    </td>
                    <td>
                      {!account.isMaster && account.status !== "revoked" && (
                        <div className="flex items-center gap-1">
                          <button
                            className={quietButton}
                            disabled={mutation.isPending}
                            onClick={() => {
                              mutation.reset();
                              mutation.mutate({ action: "rotate", account });
                            }}
                          >
                            Reset password
                          </button>
                          <button
                            className={dangerButton}
                            disabled={mutation.isPending}
                            onClick={() => {
                              mutation.reset();
                              setRevokeTarget(account);
                            }}
                          >
                            Revoke
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {mutation.error && !inviteOpen && !revokeTarget && (
        <ErrorState error={mutation.error} />
      )}
      <p className="-mt-1 text-xs leading-relaxed text-muted">
        Share temporary passwords directly with invited admins. Only the master
        admin can invite teammates, reset their passwords or revoke access.
      </p>
      {inviteOpen && (
        <Modal
          title="Invite a teammate"
          close={() => {
            if (!mutation.isPending) setInviteOpen(false);
          }}
        >
          <p className="mb-4 text-sm leading-relaxed text-muted">
            You’ll receive a single-use temporary password to share privately.
            It expires after 24 hours.
          </p>
          <form onSubmit={invite}>
            <label className="grid gap-1.5 text-xs font-medium">
              Email address
              <input
                className={field}
                name="email"
                type="email"
                autoComplete="off"
                required
                maxLength={200}
                placeholder="teammate@oren.finance"
                autoFocus
              />
            </label>
            <fieldset>
              <legend>Permissions</legend>
              <label className={permissionOption}>
                <input
                  type="checkbox"
                  name="permissions"
                  value="reports.read"
                  defaultChecked
                />
                <span>
                  <strong>Growth reports</strong>
                  <small>
                    Traffic, funnel, retention, campaigns and coverage
                  </small>
                </span>
              </label>
              <label className={permissionOption}>
                <input
                  type="checkbox"
                  name="permissions"
                  value="dashboard.access"
                />
                <span>
                  <strong>Operational dashboard</strong>
                  <small>
                    Connected account identifiers, client grants and trade
                    intents
                  </small>
                </span>
              </label>
            </fieldset>
            {mutation.error && (
              <div className={inlineNotice} role="alert">
                {mutation.error.message}
              </div>
            )}
            <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
              <button
                className={button}
                type="button"
                onClick={() => setInviteOpen(false)}
                disabled={mutation.isPending}
              >
                Cancel
              </button>
              <button className={primaryButton} disabled={mutation.isPending}>
                {mutation.isPending
                  ? "Creating invitation…"
                  : "Create invitation"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {revokeTarget && (
        <Modal
          title="Revoke admin access?"
          close={() => {
            if (!mutation.isPending) setRevokeTarget(null);
          }}
        >
          <p className="mb-4 text-sm leading-relaxed text-muted">
            {revokeTarget.email} will lose admin access and all of their current
            sessions will be invalidated.
          </p>
          {mutation.error && (
            <div className={inlineNotice} role="alert">
              {mutation.error.message}
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
            <button
              className={button}
              onClick={() => setRevokeTarget(null)}
              disabled={mutation.isPending}
            >
              Keep access
            </button>
            <button
              className={dangerButton}
              disabled={mutation.isPending}
              onClick={() =>
                mutation.mutate({ action: "revoke", account: revokeTarget })
              }
            >
              {mutation.isPending ? "Revoking…" : "Revoke access"}
            </button>
          </div>
        </Modal>
      )}
      {credential && (
        <Modal
          title="Share this password privately"
          close={() => {
            setCredential(null);
            mutation.reset();
          }}
        >
          <p className="mb-4 text-sm leading-relaxed text-muted">
            This password is shown once. Send it securely to{" "}
            {credential.email || "your teammate"}. No email has been sent.
          </p>
          <div className="my-4 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-panel p-3 pl-4 [&_code]:min-w-0 [&_code]:flex-1 [&_code]:font-mono [&_code]:text-[13px] [&_code]:break-all">
            <code>{credential.temporaryPassword}</code>
            <button
              className={button}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(
                    credential.temporaryPassword,
                  );
                  setCopied(true);
                } catch {
                  setCopyError(
                    "Could not copy. Select the password and copy it manually.",
                  );
                }
              }}
            >
              <Icon icon={Copy} size={16} />
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          {copyError && <p role="alert">{copyError}</p>}
          <p className="text-xs leading-relaxed text-muted">
            Expires <DateTime value={credential.expiresAt} />. The first sign-in
            consumes this temporary password.
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
            <button
              className={primaryButton}
              onClick={() => {
                setCredential(null);
                mutation.reset();
              }}
            >
              I’ve saved it securely
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

export function SecurityPage() {
  const { session, clear } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const nextPassword = String(form.get("nextPassword"));
    if (nextPassword !== form.get("confirmation")) {
      setError("Your new passwords don’t match.");
      return;
    }
    setPending(true);
    try {
      await post("auth/password", {
        currentPassword: String(form.get("currentPassword")),
        nextPassword,
      });
      clear();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not update your password.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <Panel
      title="Change your password"
      subtitle={`Signed in as ${session?.email}`}
      icon={LockKeyhole}
      className="max-w-2xl"
    >
      <form
        className="grid w-full max-w-[440px] gap-4 px-5 pt-1 pb-6 [&>button]:justify-self-start"
        onSubmit={submit}
      >
        <label className="grid gap-1.5 text-xs font-medium">
          Current password
          <input
            className={field}
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
            minLength={12}
            maxLength={200}
          />
        </label>
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
        <p className="text-xs leading-relaxed text-muted">
          Use a different password with 12–200 characters. Saving signs you out
          of every session. Sign in again with your new password.
        </p>
        {error && (
          <div className={inlineNotice} role="alert">
            {error}
          </div>
        )}
        <button className={primaryButton} disabled={pending}>
          {pending ? "Updating password…" : "Update password & sign out"}
        </button>
      </form>
    </Panel>
  );
}
