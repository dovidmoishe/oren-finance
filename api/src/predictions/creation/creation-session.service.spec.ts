import { generateKeyPairSync, sign } from 'node:crypto';
import bs58 from 'bs58';
import { CreationSessionService } from './creation-session.service';
describe('Creation ownership', () => {
  const keys = generateKeyPairSync('ed25519');
  const wallet = bs58.encode(
    keys.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32),
  );
  const proof = (message: string) =>
    bs58.encode(sign(null, Buffer.from(message), keys.privateKey));
  it('binds one-hour sessions to signed wallets and consumes the nonce', () => {
    const service = new CreationSessionService(),
      challenge = service.challenge(wallet);
    const session = service.exchange(challenge.nonce, proof(challenge.message));
    expect(service.require(`Bearer ${session.token}`, wallet)).toBe(wallet);
    expect(() => service.require(session.token, 'another-wallet')).toThrow();
    expect(() =>
      service.exchange(challenge.nonce, proof(challenge.message)),
    ).toThrow();
    const now = jest
      .spyOn(Date, 'now')
      .mockReturnValue(Date.parse(session.expiresAt));
    expect(() => service.require(session.token, wallet)).toThrow();
    now.mockRestore();
  });
  it('rejects expired challenges, malformed addresses and modified messages', () => {
    const service = new CreationSessionService();
    expect(() => service.challenge('bad')).toThrow();
    const challenge = service.challenge(wallet);
    expect(() =>
      service.exchange(
        challenge.nonce,
        proof(challenge.message + 'authorize funds'),
      ),
    ).toThrow();
    expect(() =>
      service.exchange(challenge.nonce, proof(challenge.message)),
    ).toThrow();
    const expired = service.challenge(wallet),
      now = jest
        .spyOn(Date, 'now')
        .mockReturnValue(Date.parse(expired.expiresAt));
    expect(() =>
      service.exchange(expired.nonce, proof(expired.message)),
    ).toThrow();
    now.mockRestore();
  });
});
