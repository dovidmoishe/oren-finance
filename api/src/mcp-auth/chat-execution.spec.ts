import { executionFailure } from './chat-execution';
import { SignerGateRejection } from './signer-gate.errors';

describe('executionFailure', () => {
  it.each([
    ['disabled', 'chat_trading_unavailable'],
    ['over_budget', 'over_limit'],
    ['inactive_delegation', 'chat_trading_inactive'],
    ['unsupported_route', 'unsupported_route'],
    ['gate_rejected', 'rejected_by_policy'],
    ['pending', 'pending'],
    ['unavailable', 'signer_unavailable'],
    ['unauthorized', 'signer_unavailable'],
  ])('maps the gate code %s to %s', (gateCode, code) => {
    expect(executionFailure(new SignerGateRejection(gateCode)).code).toBe(code);
  });

  it.each([
    [
      'Independent trade authorization is disabled for this user',
      'not_enabled_for_user',
    ],
    ['Independent trade authorization is inactive', 'chat_trading_inactive'],
    ['Independent trade budget exceeded', 'over_limit'],
  ])('maps the authorization error "%s"', (message, code) => {
    expect(executionFailure(new Error(message)).code).toBe(code);
  });

  it('never passes provider details through', () => {
    const failure = executionFailure(
      new Error('Privy 500: {"secret":"sk_live_abc","wallet":"..."}'),
    );
    expect(failure.code).toBe('execution_failed');
    expect(failure.message).not.toMatch(/Privy|secret|sk_live/);
    expect(executionFailure('not an error').code).toBe('execution_failed');
  });
});
