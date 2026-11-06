import { gateFailureCode } from './failure-code';
import {
  publicGateFailureCode,
  SignerGateRejection,
} from '../mcp-auth/signer-gate.errors';

describe('bounded gate rejection reasons', () => {
  it.each([
    [
      'This transaction could not be simulated. Check your USDC and SOL balances and request a fresh quote.',
      'simulation_failed',
    ],
    ['Transaction expired. Request a fresh quote.', 'transaction_expired'],
    [
      'Fresh Jupiter quote moved outside the reviewed terms',
      'reviewed_terms_changed',
    ],
    [
      'Headless Jupiter requires existing source and destination token accounts',
      'unsupported_route',
    ],
    [
      'A newly consented execute connection is required',
      'fresh_connection_required',
    ],
  ])(
    'classifies %s without exposing provider payloads',
    (message, expected) => {
      const code = gateFailureCode(new Error(message));
      expect(code).toBe(expected);
      expect(publicGateFailureCode(new SignerGateRejection(code))).toBe(
        expected,
      );
    },
  );
  it('does not expose arbitrary exceptions or gate response strings', () => {
    const secret =
      'provider error containing secret-token and signed transaction';
    expect(gateFailureCode(new Error(secret))).toBe('gate_rejected');
    expect(gateFailureCode(null)).toBe('gate_rejected');
    expect(publicGateFailureCode(new SignerGateRejection(secret))).toBe(
      'unavailable',
    );
    expect(publicGateFailureCode(new Error(secret))).toBe('unavailable');
  });
});
