import {
  clientMayPrepareTrades,
  clientMayExecuteTrades,
  isSupportedMcpRedirect,
} from './oauth-runtime';

describe('MCP client redirect allowlist', () => {
  it.each([
    'https://claude.ai/api/mcp/auth_callback',
    'http://127.0.0.1/callback',
    'http://127.0.0.1:49152/callback',
    'http://127.0.0.1:49152/callback/Abcdef12_-',
  ])('allows an exact supported callback: %s', (value) => {
    expect(isSupportedMcpRedirect(value)).toBe(true);
  });

  it.each([
    'https://claude.ai.evil.test/api/mcp/auth_callback',
    'https://claude.ai/api/mcp/auth_callback?next=evil',
    'http://127.0.0.2:49152/callback',
    'http://localhost:49152/callback',
    'https://127.0.0.1:49152/callback',
    'http://127.0.0.1:49152/callback/../../steal',
    'http://127.0.0.1:49152/callback?next=evil',
    'http://127.0.0.1:49152/callback#fragment',
    'http://user@127.0.0.1:49152/callback',
  ])('rejects other callbacks: %s', (value) => {
    expect(isSupportedMcpRedirect(value)).toBe(false);
  });
});

describe('MCP client trade scope', () => {
  it('allows the Claude pilot client to request browser trade preparation', () => {
    expect(
      clientMayPrepareTrades(['https://claude.ai/api/mcp/auth_callback']),
    ).toBe(true);
  });

  it('keeps a local Codex client read-only', () => {
    expect(clientMayPrepareTrades(['http://127.0.0.1:49152/callback'])).toBe(
      false,
    );
    expect(clientMayPrepareTrades(undefined)).toBe(false);
  });

  it('limits execution permission to the exact Claude callback', () => {
    expect(
      clientMayExecuteTrades(['https://claude.ai/api/mcp/auth_callback']),
    ).toBe(true);
    expect(clientMayExecuteTrades(['http://127.0.0.1:49152/callback'])).toBe(
      false,
    );
    expect(
      clientMayExecuteTrades([
        'https://claude.ai/api/mcp/auth_callback',
        'http://127.0.0.1/callback',
      ]),
    ).toBe(false);
  });
});
