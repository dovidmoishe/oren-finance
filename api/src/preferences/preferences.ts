import { BadRequestException } from '@nestjs/common';

import { isSectorId, sectorIds } from '../../types/sectors';

const fields = new Set([
  'sectors',
  'morningBrief',
  'breakingNews',
  'briefTime',
  'timeZone',
]);

export function parsePreferences(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestException('Preferences are required');
  }
  if (Object.keys(body).some((key) => !fields.has(key))) {
    throw new BadRequestException('Unknown preference field');
  }
  const { sectors, morningBrief, breakingNews, briefTime, timeZone } =
    body as Record<string, unknown>;
  if (
    !Array.isArray(sectors) ||
    sectors.length > sectorIds.length ||
    !sectors.every(isSectorId) ||
    new Set(sectors).size !== sectors.length
  ) {
    throw new BadRequestException('Invalid sectors');
  }
  if (typeof morningBrief !== 'boolean' || typeof breakingNews !== 'boolean') {
    throw new BadRequestException('Email preferences must be booleans');
  }
  if (
    typeof briefTime !== 'string' ||
    !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(briefTime)
  ) {
    throw new BadRequestException('Use HH:mm for the brief time');
  }
  if (
    typeof timeZone !== 'string' ||
    !/^[A-Za-z][A-Za-z_+0-9-]*(?:\/[A-Za-z_+0-9-]+)*$/.test(timeZone) ||
    timeZone.length > 80
  ) {
    throw new BadRequestException('Invalid time zone');
  }
  let zone: string;
  try {
    zone = new Intl.DateTimeFormat('en', { timeZone }).resolvedOptions()
      .timeZone;
  } catch {
    throw new BadRequestException('Invalid time zone');
  }
  return { sectors, morningBrief, breakingNews, briefTime, timeZone: zone };
}
