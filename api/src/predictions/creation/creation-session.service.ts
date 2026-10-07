import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';
import bs58 from 'bs58';
const PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const digest = (s: string) => createHash('sha256').update(s).digest('hex');

@Injectable()
export class CreationSessionService {
  private readonly challenges = new Map<
    string,
    { wallet: string; message: string; expires: number }
  >();
  private readonly sessions = new Map<
    string,
    { wallet: string; expires: number }
  >();
  challenge(wallet: string) {
    try {
      if (bs58.decode(wallet).length !== 32) throw new Error();
    } catch {
      throw new BadRequestException('Invalid wallet');
    }
    this.prune();
    if (this.challenges.size >= 1000)
      throw new BadRequestException('Too many pending wallet challenges');
    const nonce = randomBytes(32).toString('hex');
    const expires = Date.now() + 300_000;
    const message = `Oren prediction creation session\nWallet: ${wallet}\nNonce: ${nonce}\nExpires: ${new Date(expires).toISOString()}\nThis verifies draft ownership. It does not authorize any transaction.`;
    this.challenges.set(nonce, { wallet, message, expires });
    return { nonce, message, expiresAt: new Date(expires).toISOString() };
  }
  exchange(nonce: string, signature: string) {
    const challenge = this.challenges.get(nonce);
    this.challenges.delete(nonce); // Single-use even on failed verification.
    if (!challenge || challenge.expires <= Date.now())
      throw new UnauthorizedException('Wallet challenge expired');
    try {
      const key = createPublicKey({
        key: Buffer.concat([
          PREFIX,
          Buffer.from(bs58.decode(challenge.wallet)),
        ]),
        format: 'der',
        type: 'spki',
      });
      if (
        !verify(
          null,
          Buffer.from(challenge.message),
          key,
          Buffer.from(bs58.decode(signature)),
        )
      )
        throw new Error();
    } catch {
      throw new UnauthorizedException('Invalid wallet proof');
    }
    this.prune();
    if (this.sessions.size >= 1000)
      throw new BadRequestException('Too many creation sessions');
    const token = randomBytes(32).toString('hex');
    const expires = Date.now() + 3_600_000;
    this.sessions.set(digest(token), { wallet: challenge.wallet, expires });
    return {
      token,
      wallet: challenge.wallet,
      expiresAt: new Date(expires).toISOString(),
    };
  }
  require(token?: string, wallet?: string) {
    const session = token
      ? this.sessions.get(digest(token.replace(/^Bearer /, '')))
      : undefined;
    if (
      !session ||
      session.expires <= Date.now() ||
      (wallet && wallet !== session.wallet)
    )
      throw new UnauthorizedException(
        'Verify the connected wallet to access creation drafts',
      );
    return session.wallet;
  }
  private prune() {
    for (const [key, value] of this.challenges)
      if (value.expires <= Date.now()) this.challenges.delete(key);
    for (const [key, value] of this.sessions)
      if (value.expires <= Date.now()) this.sessions.delete(key);
  }
}
