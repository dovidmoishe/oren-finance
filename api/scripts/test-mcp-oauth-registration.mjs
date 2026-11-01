import assert from 'node:assert/strict'
import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const express = require(require.resolve('express', {
  paths: [require.resolve('@nestjs/platform-express')],
}))
const request = require('supertest')
const {
  createMcpOAuthRuntime,
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
const db = {
  insert: () => ({
    values: (row) => ({
      onConflictDoUpdate: async () => {
        stored.set(String(row.key), row)
      },
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
assert.equal(pathMetadata.body.authorization_endpoint, 'https://api.oren.finance/oauth/auth')
assert.equal(pathMetadata.body.token_endpoint, 'https://api.oren.finance/oauth/token')
assert.equal(pathMetadata.body.registration_endpoint, 'https://api.oren.finance/oauth/reg')
const metadata = await request(app)
  .get('/oauth/.well-known/openid-configuration')
  .set('Host', 'api.oren.finance')
  .set('X-Forwarded-Host', 'api.oren.finance')
  .set('X-Forwarded-Proto', 'https')
assert.equal(metadata.status, 200, JSON.stringify(metadata.body))
assert.equal(metadata.body.registration_endpoint, 'https://api.oren.finance/oauth/reg')
const registration = await request(app).post('/oauth/reg').send({
  redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
  token_endpoint_auth_method: 'none',
  response_types: ['code'],
  grant_types: ['authorization_code', 'refresh_token'],
  client_name: 'Oren test',
})
assert.equal(registration.status, 201, JSON.stringify(registration.body))
assert.equal(registration.body.token_endpoint_auth_method, 'none')
assert.deepEqual(registration.body.redirect_uris, ['https://claude.ai/api/mcp/auth_callback'])
assert.equal(typeof registration.body.client_id, 'string')
assert.ok(stored.size > 0)
const disallowed = await request(app).post('/oauth/reg').send({
  redirect_uris: ['https://attacker.example/callback'],
  token_endpoint_auth_method: 'none',
  response_types: ['code'],
  grant_types: ['authorization_code'],
})
assert.equal(disallowed.status, 400)
console.log('MCP OAuth discovery and Claude dynamic registration pass')
