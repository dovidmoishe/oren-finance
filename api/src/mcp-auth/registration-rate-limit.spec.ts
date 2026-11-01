import { createRegistrationRateLimit } from './registration-rate-limit';

describe('MCP dynamic registration limit', () => {
  it('bounds attempts and permits registrations after the window passes', () => {
    const retryAfter = createRegistrationRateLimit(2, 60_000);
    expect(retryAfter(10_000)).toBe(0);
    expect(retryAfter(10_001)).toBe(0);
    expect(retryAfter(10_002)).toBe(60);
    expect(retryAfter(70_000)).toBe(0);
  });
});
