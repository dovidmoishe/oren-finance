export function notificationSettings(env = process.env) {
  const preview = env.DEPLOYMENT_ENV === 'preview';
  const fixture = env.NOTIFICATION_FIXTURE_MODE === 'true';
  const safe = !preview || fixture;
  const origin = env.NOTIFICATION_APP_ORIGIN?.trim();
  const apiOrigin = env.NOTIFICATION_API_ORIGIN?.trim() || origin;
  const fixtureRecipient =
    env.NOTIFICATION_FIXTURE_RECIPIENT?.trim().toLowerCase();
  const validOrigin = [origin, apiOrigin].every(
    (value) => value && /^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(value),
  );
  const enabled =
    safe &&
    Boolean(
      validOrigin && (env.NOTIFICATION_UNSUBSCRIBE_SECRET?.length ?? 0) >= 32,
    ) &&
    (!fixture || Boolean(fixtureRecipient));
  const alertMints = new Set(
    (env.NOTIFICATION_ALERT_MINTS ?? '')
      .split(',')
      .map((mint) => mint.trim())
      .filter((mint) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)),
  );
  const alerts =
    enabled &&
    alertMints.size > 0 &&
    positive(env.NOTIFICATION_TOKENS_PER_MINUTE) > 0 &&
    positive(env.NOTIFICATION_EMAIL_PER_MINUTE) > 0 &&
    env.PRICE_ALERTS_ENABLED === 'true' &&
    env.TOKENS_ALERT_TIMESTAMPS_VERIFIED === 'true';
  return {
    enabled,
    briefs: enabled && env.MORNING_BRIEF_ENABLED === 'true',
    alerts,
    alertMints,
    fixture,
    fixtureRecipient,
    origin,
    apiOrigin,
    secret: env.NOTIFICATION_UNSUBSCRIBE_SECRET,
    redisUrl: env.NOTIFICATION_REDIS_URL,
    tokensPerMinute: positive(env.NOTIFICATION_TOKENS_PER_MINUTE),
    emailPerMinute: positive(env.NOTIFICATION_EMAIL_PER_MINUTE),
    pilotUsers: new Set(
      (env.NOTIFICATION_PILOT_USERS ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  };
}

function positive(value: string | undefined) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}
