import type Provider from 'oidc-provider';
import { createMcpOAuthAdapter } from './oauth-adapter';
import type { Database } from '../database/database.provider';

export interface McpOAuthRuntime {
  provider: Provider;
  issuer: string;
  appOrigin: string;
  resource: string;
}

/** Keep public client registration limited to the pilot and Codex loopback. */
export function isSupportedMcpRedirect(value: string): boolean {
  if (value === 'https://claude.ai/api/mcp/auth_callback') return true;
  let redirect: URL;
  try {
    redirect = new URL(value);
  } catch {
    return false;
  }
  return (
    redirect.protocol === 'http:' &&
    redirect.hostname === '127.0.0.1' &&
    !redirect.username &&
    !redirect.password &&
    !redirect.search &&
    !redirect.hash &&
    /^\/callback(?:\/[A-Za-z0-9_-]{8,128})?$/.test(redirect.pathname)
  );
}

/** Local Codex clients are limited to portfolio and market reads. */
export function clientMayPrepareTrades(
  redirectUris?: readonly string[],
): boolean {
  return (
    redirectUris?.length === 1 &&
    redirectUris[0] === 'https://claude.ai/api/mcp/auth_callback'
  );
}

/** Disabled by default; partial configuration must fail startup, not weaken auth. */
export async function createMcpOAuthRuntime(
  db: Database,
  env: NodeJS.ProcessEnv = process.env,
): Promise<McpOAuthRuntime | undefined> {
  if (env.MCP_OAUTH_ENABLED !== 'true') return undefined;
  const issuer = env.MCP_OAUTH_ISSUER?.trim();
  const appOrigin = env.MCP_APP_ORIGIN?.trim();
  const storageKey = Buffer.from(env.MCP_OAUTH_STORAGE_KEY ?? '', 'base64');
  const cookieKeys = (env.MCP_OAUTH_COOKIE_KEYS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const jwksJson = env.MCP_OAUTH_JWKS;
  if (
    !issuer ||
    !appOrigin ||
    storageKey.length < 32 ||
    cookieKeys.length < 2 ||
    cookieKeys.some((key) => key.length < 32) ||
    !jwksJson
  )
    throw new Error('MCP OAuth configuration is incomplete');
  const issuerUrl = new URL(issuer);
  const appUrl = new URL(appOrigin);
  if (
    issuerUrl.search ||
    issuerUrl.hash ||
    issuerUrl.username ||
    issuerUrl.password ||
    appUrl.search ||
    appUrl.hash ||
    appUrl.username ||
    appUrl.password
  )
    throw new Error('MCP OAuth URLs must be plain origins');
  const local =
    env.NODE_ENV !== 'production' && issuerUrl.hostname === 'localhost';
  if (
    (issuerUrl.protocol !== 'https:' && !local) ||
    appUrl.protocol !== 'https:'
  )
    throw new Error('MCP OAuth requires HTTPS');
  if (issuerUrl.pathname !== '/oauth' || appUrl.pathname !== '/')
    throw new Error('Unexpected MCP OAuth origin path');
  const resource = `${issuerUrl.origin}/mcp`;
  const jwks = JSON.parse(jwksJson) as { keys: Record<string, unknown>[] };
  if (!Array.isArray(jwks.keys) || jwks.keys.length < 1)
    throw new Error('MCP OAuth signing key is missing');
  const { default: OidcProvider, errors } = await import('oidc-provider');
  const provider = new OidcProvider(issuer, {
    adapter: createMcpOAuthAdapter(db, storageKey),
    jwks,
    cookies: { keys: cookieKeys },
    pkce: { required: () => true },
    responseTypes: ['code'],
    scopes: ['oren.read', 'oren.trade.prepare', 'offline_access'],
    clientAuthMethods: ['none'],
    rotateRefreshToken: true,
    issueRefreshToken: () => true,
    ttl: { AccessToken: 600, RefreshToken: 7 * 24 * 60 * 60 },
    findAccount: (_context, accountId) => ({
      accountId,
      claims: () => ({ sub: accountId }),
    }),
    interactions: {
      url: (_context, interaction) =>
        `${appUrl.origin}/connect/mcp?uid=${encodeURIComponent(interaction.uid)}`,
    },
    features: {
      devInteractions: { enabled: false },
      registration: { enabled: true, initialAccessToken: false },
      resourceIndicators: {
        enabled: true,
        getResourceServerInfo: (_context, requested) => {
          if (requested !== resource) throw new errors.InvalidTarget();
          return {
            scope: 'oren.read oren.trade.prepare',
            audience: resource,
            accessTokenTTL: 600,
          };
        },
        defaultResource: () => resource,
      },
    },
    extraClientMetadata: {
      properties: ['oren_client_policy'],
      validator: (context, _key, _value, metadata) => {
        if (!context) return;
        if (
          metadata.redirect_uris?.length !== 1 ||
          !isSupportedMcpRedirect(metadata.redirect_uris[0]) ||
          metadata.token_endpoint_auth_method !== 'none' ||
          metadata.response_types?.join(' ') !== 'code' ||
          !metadata.grant_types?.includes('authorization_code')
        )
          throw new errors.InvalidClientMetadata('Unsupported MCP client');
      },
    },
  });
  provider.proxy = true;
  return { provider, issuer, appOrigin: appUrl.origin, resource };
}
