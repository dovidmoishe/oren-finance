import http from 'node:http';
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const cookieName = '__Host-oren-preview';
export function signSession(host, key, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ host, expires: now + 8 * 60 * 60_000 })).toString('base64url');
  return `${payload}.${createHmac('sha256', key).update(payload).digest('base64url')}`;
}
export function validSession(token, host, key, now = Date.now()) {
  try {
    const [payload, signature, extra] = token.split('.');
    if (extra) return false;
    const expected = createHmac('sha256', key).update(payload).digest();
    const actual = Buffer.from(signature, 'base64url');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return data.host === host && Number.isFinite(data.expires) && data.expires > now && data.expires <= now + 8 * 60 * 60_000;
  } catch { return false; }
}
export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  return `${salt}:${scryptSync(password, salt, 32).toString('hex')}`;
}
const page = (logout = false) => `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Oren preview access</title><style>body{font:16px system-ui;max-width:360px;margin:15vh auto;padding:24px}input,button{box-sizing:border-box;width:100%;padding:12px;margin-top:16px}</style><h1>Oren internal preview</h1><p>${logout ? 'Lock this preview on this browser.' : 'Enter the shared tester password, then sign in to Oren.'}</p><form method="post" action="/_preview/${logout ? 'logout' : 'login'}">${logout ? '' : '<label>Preview password<input name="password" type="password" required maxlength="256" autocomplete="current-password"></label>'}<button>${logout ? 'Lock preview' : 'Open preview'}</button></form></html>`;

export function createAccessServer({ key, passwordHash, domain }) {
  if (!key || key.length < 32 || !/^[a-f0-9]{32}:[a-f0-9]{64}$/.test(passwordHash ?? '') || !/^[a-z0-9.-]+$/.test(domain ?? '')) throw Error('Invalid preview access configuration');
  const attempts = new Map();
  const cookie = (token, age) => `${cookieName}=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${age}`;
  return http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'");
    const host = String(req.headers['x-preview-host'] ?? '');
    if (!new RegExp(`^pr-[1-9][0-9]*\\.${domain.replaceAll('.', '\\.').replaceAll('-', '\\-')}$`).test(host)) { res.writeHead(400).end(); return; }
    const path = (req.url ?? '').split('?')[0];
    if (path === '/verify') {
      const token = String(req.headers.cookie ?? '').split(';').map(x => x.trim()).find(x => x.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) ?? '';
      if (validSession(token, host, key)) res.writeHead(204).end();
      else res.writeHead(302, { Location: '/_preview/login' }).end();
      return;
    }
    if (!['/_preview/login', '/_preview/logout'].includes(path)) { res.writeHead(404).end(); return; }
    if (req.method === 'GET') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(page(path.endsWith('logout'))); return; }
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }
    if (req.headers.origin !== `https://${host}` || !String(req.headers['content-type']).startsWith('application/x-www-form-urlencoded')) { res.writeHead(403).end(); return; }
    if (path.endsWith('logout')) { res.writeHead(303, { 'Set-Cookie': cookie('', 0), Location: '/_preview/login' }).end(); return; }
    const now = Date.now();
    for (const [ip, value] of attempts) if (value.until < now) attempts.delete(ip);
    const ip = String(req.headers['x-preview-client'] ?? req.socket.remoteAddress);
    const entry = attempts.get(ip) ?? { count: 0, until: now + 60_000 };
    if (entry.count >= 10 || (!attempts.has(ip) && attempts.size >= 10_000)) { res.writeHead(429, { 'Retry-After': '60' }).end('Try again later.'); return; }
    entry.count++; attempts.set(ip, entry);
    let body = '';
    try {
      for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 2048) { res.writeHead(413).end(); return; } }
      const password = new URLSearchParams(body).get('password') ?? '';
      const [salt, expected] = passwordHash.split(':');
      if (password.length > 256 || !timingSafeEqual(scryptSync(password, salt, 32), Buffer.from(expected, 'hex'))) { res.writeHead(401).end('Incorrect preview password.'); return; }
      res.writeHead(303, { 'Set-Cookie': cookie(signSession(host, key), 28_800), Location: '/' }).end();
    } catch { if (!res.headersSent) res.writeHead(400).end(); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === 'hash') {
    let password = ''; for await (const chunk of process.stdin) password += chunk;
    process.stdout.write(hashPassword(password.trimEnd()) + '\n');
  } else {
    const server = createAccessServer({ key: process.env.PREVIEW_SESSION_KEY, passwordHash: process.env.PREVIEW_PASSWORD_HASH, domain: process.env.PREVIEW_DOMAIN });
    server.requestTimeout = 10_000;
    server.headersTimeout = 10_000;
    server.listen(8080, '0.0.0.0');
  }
}
