# MCP connection consent

Public callback registration identifies compatible redirects, not an authenticated desktop app. PKCE protects a code intercepted from a legitimate authorization request; it cannot authenticate a program that starts its own request and knows its own verifier. See [RFC 8252 sections 8.3 and 8.6](https://www.rfc-editor.org/rfc/rfc8252).

Every new authorization must visit Oren consent, including a repeated authorization for an already-approved public client. The explicit `oren_connection_consent` provider policy enforces this independently of registration `application_type`. This matters for existing Codex clients registered as `web`, which otherwise inherit the provider's web-session grant reuse. Resuming the same approved interaction completes normally; refresh tokens continue under the original revocable connection.

Consent details describe the actual selected, provider-validated callback. A Cursor registration may include HTTPS, loopback and a custom scheme; only the selected callback determines whether local-app acknowledgement is needed. Provider-approved native loopback port changes remain allowed. The server independently requires `X-Oren-Native-Client-Consent: true` for local callbacks before creating a connection. This is informed consent, not app attestation. Execute consent and the active owner-signed bounded wallet grant remain separate requirements.

The browser resets both acknowledgements when the interaction UID changes. It displays the callback destination instead of implying that self-declared client metadata verifies Cursor or Codex.

## Verification and rollout

- Build API source before running `pnpm run test:mcp:registration`; the smoke loads `dist`. It uses disposable keys and mocked persistence/identity, and verifies selected web/native callbacks, native acknowledgement, mandatory PKCE, code replay rejection and repeated authorization requiring consent.
- `client-consent.spec.ts` covers destination selection, unknown callbacks, strict acknowledgements and provider-approved native ports.
- Deploy API and web together. An old web client that lacks the native acknowledgement header fails closed for new local connections; reload and restart connection setup after deployment.
- No migration, new credentials, public enrollment flag or signer policy change is required. Existing OAuth tokens are not invalidated by this change; revoke a suspicious connection through the existing settings flow. A fresh authorization must obtain new browser consent, while token refresh remains subject to the existing connection checks.
- Live Claude, Cursor and Codex connections, authenticated UI interaction, production enrollment and a disposable funded trade remain deployment acceptance checks. These local regressions do not prove live financial execution.
