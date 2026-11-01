/** Bound public dynamic client registrations on the single API instance. */
export function createRegistrationRateLimit(
  maxAttempts = 60,
  windowMs = 60 * 60_000,
) {
  const attempts: number[] = [];
  return (now = Date.now()): number => {
    while (attempts.length && attempts[0] <= now - windowMs) attempts.shift();
    if (attempts.length >= maxAttempts)
      return Math.max(1, Math.ceil((attempts[0] + windowMs - now) / 1000));
    attempts.push(now);
    return 0;
  };
}
