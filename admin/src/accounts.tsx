import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X, Copy } from "lucide-react";
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
      className="modal"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      aria-labelledby="modal-title"
    >
      <div className="modal-heading">
        <h2 id="modal-title">{title}</h2>
        <button
          className="icon-button"
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
        subtitle="Manage invitations, permissions and account access."
        action={
          <button
            className="primary"
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
          <ErrorState error={query.error} retry={() => void query.refetch()} />
        ) : query.data.length === 0 ? (
          <Empty title="No admin accounts returned" />
        ) : (
          <div className="table-scroll">
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
                      <div className="account-identity">
                        <span className="account-initial" aria-hidden="true">
                          {account.email.charAt(0).toUpperCase()}
                        </span>
                        <div>
                          <span className="strong">{account.email}</span>
                          {account.id === session.id && (
                            <span className="cell-note">You</span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td>
                      <Badge>
                        {account.isMaster ? "Master admin" : "Admin"}
                      </Badge>
                    </td>
                    <td>
                      <div className="scope-list">
                        {account.permissions.map((permission) => (
                          <Badge key={permission}>{permission}</Badge>
                        ))}
                      </div>
                    </td>
                    <td>
                      <Status value={account.status} />
                      {account.mustChangePassword &&
                        account.status !== "revoked" && (
                          <span className="cell-note">
                            Password replacement required
                          </span>
                        )}
                    </td>
                    <td>
                      {!account.isMaster && account.status !== "revoked" && (
                        <div className="row-actions">
                          <button
                            className="subtle"
                            disabled={mutation.isPending}
                            onClick={() => {
                              mutation.reset();
                              mutation.mutate({ action: "rotate", account });
                            }}
                          >
                            Reset password
                          </button>
                          <button
                            className="subtle danger"
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
      <p className="panel-note">
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
          <p className="modal-description">
            You’ll receive a single-use temporary password to share privately.
            It expires after 24 hours.
          </p>
          <form onSubmit={invite}>
            <label>
              Email address
              <input
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
              <label className="checkbox-option">
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
              <label className="checkbox-option">
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
              <div className="notice error" role="alert">
                {mutation.error.message}
              </div>
            )}
            <div className="modal-actions">
              <button
                type="button"
                onClick={() => setInviteOpen(false)}
                disabled={mutation.isPending}
              >
                Cancel
              </button>
              <button className="primary" disabled={mutation.isPending}>
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
          <p className="modal-description">
            {revokeTarget.email} will lose admin access and all of their current
            sessions will be invalidated.
          </p>
          {mutation.error && (
            <div className="notice error" role="alert">
              {mutation.error.message}
            </div>
          )}
          <div className="modal-actions">
            <button
              onClick={() => setRevokeTarget(null)}
              disabled={mutation.isPending}
            >
              Keep access
            </button>
            <button
              className="primary destructive"
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
          <p className="modal-description">
            This password is shown once. Send it securely to{" "}
            {credential.email || "your teammate"}. No email has been sent.
          </p>
          <div className="credential">
            <code>{credential.temporaryPassword}</code>
            <button
              className="button"
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
          <p className="form-help">
            Expires <DateTime value={credential.expiresAt} />. The first sign-in
            consumes this temporary password.
          </p>
          <div className="modal-actions">
            <button
              className="primary"
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
    >
      <form className="security-form" onSubmit={submit}>
        <label>
          Current password
          <input
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
            minLength={12}
            maxLength={200}
          />
        </label>
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
          Use a different password with 12–200 characters. Saving signs you out
          of every session. Sign in again with your new password.
        </p>
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        <button className="primary" disabled={pending}>
          {pending ? "Updating password…" : "Update password & sign out"}
        </button>
      </form>
    </Panel>
  );
}
