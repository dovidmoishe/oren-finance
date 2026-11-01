import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { PgDialect } from 'drizzle-orm/pg-core'

const require = createRequire(import.meta.url)
const express = require(
  require.resolve('express', {
    paths: [require.resolve('@nestjs/platform-express')],
  }),
)
const request = require('supertest')
const {
  createMcpOAuthRuntime,
  mcpInteractionUrl,
  mountPathBasedDiscoveryAtIssuer,
} = require('../dist/src/mcp-auth/oauth-runtime.js')

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const signingKey = {
  ...privateKey.export({ format: 'jwk' }),
  kid: 'registration-test',
  alg: 'RS256',
  use: 'sig',
}
const stored = new Map()
const dialect = new PgDialect()
function matchingRow(condition) {
  const { params } = dialect.sqlToQuery(condition)
  return [...stored.values()].find(
    (item) =>
      params.includes(item.model) &&
      (params.includes(item.key) || params.includes(item.uidHash)),
  )
}
const db = {
  insert: () => ({
    values: (row) => ({
      onConflictDoUpdate: async () => {
        stored.set(String(row.key), row)
      },
    }),
  }),
  select: () => ({
    from: () => ({
      where: (condition) => ({
        limit: async () => {
          const row = matchingRow(condition)
          return row ? [{ payload: row.payload }] : []
        },
      }),
    }),
  }),
  delete: () => ({
    where: async (condition) => {
      const row = matchingRow(condition)
      if (row) stored.delete(row.key)
    },
  }),
  update: () => ({
    set: () => ({
      where: (condition) => ({
        returning: async () => {
          const row = matchingRow(condition)
          if (!row || row.payload.consumed) return []
          row.payload = {
            ...row.payload,
            consumed: Math.floor(Date.now() / 1000),
          }
          return [{ key: row.key }]
        },
      }),
    }),
  }),
}
const runtime = await createMcpOAuthRuntime(db, {
  NODE_ENV: 'test',
  MCP_OAUTH_ENABLED: 'true',
  MCP_OAUTH_ISSUER: 'https://api.oren.finance/oauth',
  MCP_APP_ORIGIN: 'https://oren.finance',
  MCP_OAUTH_STORAGE_KEY: randomBytes(32).toString('base64'),
  MCP_OAUTH_COOKIE_KEYS: `${randomBytes(32).toString('hex')},${randomBytes(32).toString('hex')}`,
  MCP_OAUTH_JWKS: JSON.stringify({ keys: [signingKey] }),
})
assert.ok(runtime)
const app = express()
app.get('/oauth/interaction/:uid', async (req, res) => {
  try {
    const details = await runtime.provider.interactionDetails(req, res)
    if (details.uid !== req.params.uid) return res.sendStatus(403)
    if (req.query.launch === '1')
      return res.redirect(
        303,
        `${runtime.appOrigin}/connect/mcp?uid=${encodeURIComponent(details.uid)}`,
      )
    return res.json({ clientId: details.params.client_id })
  } catch {
    return res.sendStatus(400)
  }
})
app.post('/oauth/interaction/:uid', async (req, res) => {
  try {
    const details = await runtime.provider.interactionDetails(req, res)
    if (details.uid !== req.params.uid) return res.sendStatus(403)
    const grant = new runtime.provider.Grant({
      accountId: 'disposable-test-user',
      clientId: details.params.client_id,
    })
    grant.addResourceScope(runtime.resource, [
      'oren.read',
      'oren.trade.prepare',
    ])
    grant.addOIDCScope('offline_access')
    const grantId = await grant.save()
    const redirect = await runtime.provider.interactionResult(
      req,
      res,
      {
        login: {
          accountId: 'disposable-test-user',
          amr: ['email_otp'],
          remember: false,
        },
        consent: { grantId },
      },
      { mergeWithLastSubmission: false },
    )
    return res.json({ redirect })
  } catch {
    return res.sendStatus(400)
  }
})
app.use('/.well-known/oauth-authorization-server/oauth', (req, res) => {
  mountPathBasedDiscoveryAtIssuer(req)
  return runtime.provider.callback()(req, res)
})
app.use('/oauth', runtime.provider.callback())
const pathMetadata = await request(app)
  .get('/.well-known/oauth-authorization-server/oauth')
  .set('Host', 'api.oren.finance')
  .set('X-Forwarded-Host', 'api.oren.finance')
  .set('X-Forwarded-Proto', 'https')
assert.equal(pathMetadata.status, 200, JSON.stringify(pathMetadata.body))
assert.equal(
  pathMetadata.body.authorization_endpoint,
  'https://api.oren.finance/oauth/auth',
)
assert.equal(
  pathMetadata.body.token_endpoint,
  'https://api.oren.finance/oauth/token',
)
assert.equal(
  pathMetadata.body.registration_endpoint,
  'https://api.oren.finance/oauth/reg',
)
const metadata = await request(app)
  .get('/oauth/.well-known/openid-configuration')
  .set('Host', 'api.oren.finance')
  .set('X-Forwarded-Host', 'api.oren.finance')
  .set('X-Forwarded-Proto', 'https')
assert.equal(metadata.status, 200, JSON.stringify(metadata.body))
assert.equal(
  metadata.body.registration_endpoint,
  'https://api.oren.finance/oauth/reg',
)
const registration = await request(app)
  .post('/oauth/reg')
  .send({
    redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
    token_endpoint_auth_method: 'none',
    response_types: ['code'],
    grant_types: ['authorization_code', 'refresh_token'],
    client_name: 'Oren test',
  })
assert.equal(registration.status, 201, JSON.stringify(registration.body))
assert.equal(registration.body.token_endpoint_auth_method, 'none')
assert.deepEqual(registration.body.redirect_uris, [
  'https://claude.ai/api/mcp/auth_callback',
])
assert.equal(typeof registration.body.client_id, 'string')
assert.ok(stored.size > 0)
const verifier = 'a'.repeat(64)
const challenge = createHash('sha256').update(verifier).digest('base64url')
const authorization = await request(app)
  .get('/oauth/auth')
  .query({
    client_id: registration.body.client_id,
    redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
    response_type: 'code',
    scope: 'oren.read oren.trade.prepare offline_access',
    resource: 'https://api.oren.finance/mcp',
    state: 'registration-test',
    code_challenge: challenge,
    code_challenge_method: 'S256',
  })
  .set('Host', 'api.oren.finance')
  .set('X-Forwarded-Host', 'api.oren.finance')
  .set('X-Forwarded-Proto', 'https')
assert.equal(authorization.status, 303, JSON.stringify(authorization.body))
const launch = new URL(authorization.headers.location)
assert.equal(launch.origin, 'https://api.oren.finance')
assert.equal(launch.searchParams.get('launch'), '1')
assert.equal(
  launch.href,
  mcpInteractionUrl(runtime.issuer, launch.pathname.split('/').at(-1)),
)
const cookie = authorization.headers['set-cookie']?.find((value) =>
  value.startsWith('_interaction='),
)
assert.ok(cookie, 'interaction cookie must be set')
assert.ok(
  cookie.toLowerCase().includes(`path=${launch.pathname.toLowerCase()}`),
  `interaction cookie path ${cookie.match(/path=[^;]*/i)?.[0]} must match ${launch.pathname}`,
)
const cookiePair = authorization.headers['set-cookie']
  .map((value) => value.split(';')[0])
  .join('; ')
const forwarded = {
  Host: 'api.oren.finance',
  'X-Forwarded-Host': 'api.oren.finance',
  'X-Forwarded-Proto': 'https',
  Cookie: cookiePair,
}
const landing = await request(app)
  .get(`${launch.pathname}${launch.search}`)
  .set(forwarded)
assert.equal(landing.status, 303, 'API launch must accept its scoped cookie')
assert.equal(new URL(landing.headers.location).pathname, '/connect/mcp')
const details = await request(app).get(launch.pathname).set(forwarded)
assert.equal(
  details.status,
  200,
  'app detail request must accept the same cookie',
)
assert.equal(details.body.clientId, registration.body.client_id)
const wrongInteraction = await request(app)
  .get('/oauth/interaction/wrong-uid')
  .set(forwarded)
assert.equal(
  wrongInteraction.status,
  403,
  'cookie must not access another interaction URL',
)
const missingCookie = await request(app).get(launch.pathname)
assert.equal(
  missingCookie.status,
  400,
  'interaction details require the cookie',
)
const consent = await request(app)
  .post(launch.pathname)
  .set({ ...forwarded, Origin: runtime.appOrigin })
assert.equal(consent.status, 200, 'consent must persist a grant')
const resume = await request(app)
  .get(new URL(consent.body.redirect).pathname)
  .set(forwarded)
assert.equal(resume.status, 303, 'completed consent must leave Oren')
assert.equal(
  new URL(resume.headers.location).origin,
  'https://claude.ai',
  'completed consent must return to Claude instead of starting another prompt',
)
const callback = new URL(resume.headers.location)
assert.equal(callback.searchParams.get('state'), 'registration-test')
const code = callback.searchParams.get('code')
assert.ok(code, 'Claude callback must contain an authorization code')
const token = await request(app)
  .post('/oauth/token')
  .type('form')
  .send({
    grant_type: 'authorization_code',
    client_id: registration.body.client_id,
    code,
    code_verifier: verifier,
    redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
  })
  .set('Host', 'api.oren.finance')
  .set('X-Forwarded-Host', 'api.oren.finance')
  .set('X-Forwarded-Proto', 'https')
assert.equal(token.status, 200, 'Claude must be able to exchange the code')
assert.equal(token.body.token_type, 'Bearer')
assert.equal(typeof token.body.access_token, 'string')
assert.equal(typeof token.body.refresh_token, 'string')
assert.ok(token.body.scope?.includes('oren.read'))
assert.ok(token.body.scope?.includes('oren.trade.prepare'))
const disallowed = await request(app)
  .post('/oauth/reg')
  .send({
    redirect_uris: ['https://attacker.example/callback'],
    token_endpoint_auth_method: 'none',
    response_types: ['code'],
    grant_types: ['authorization_code'],
  })
assert.equal(disallowed.status, 400)
console.log(
  'MCP OAuth discovery, Claude registration, consent callback, and token exchange pass',
)
