import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Inject,
  Put,
} from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { PrivyWalletAuth } from '../auth/privy-wallet-auth';
import { DRIZZLE } from '../config/constants';
import type { Database } from '../database/database.provider';
import { userPreferences } from '../database/schema';
import { nextBrief } from '../notifications/schedule';
import { parsePreferences } from './preferences';

const fields = {
  sectors: userPreferences.sectors,
  morningBrief: userPreferences.morningBrief,
  breakingNews: userPreferences.breakingNews,
  briefTime: userPreferences.briefTime,
  timeZone: userPreferences.timeZone,
};

@Controller('me/preferences')
export class PreferencesController {
  constructor(
    private readonly auth: PrivyWalletAuth,
    @Inject(DRIZZLE) private readonly db: Database,
  ) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  async get(@Headers('authorization') authorization?: string) {
    const { userId, email } =
      await this.auth.requireAccountIdentity(authorization);
    const [preferences] = await this.db
      .select(fields)
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId));
    return { preferences: preferences ?? null, emailEligible: Boolean(email) };
  }

  @Put()
  @Header('Cache-Control', 'private, no-store')
  async put(
    @Body() body: unknown,
    @Headers('authorization') authorization?: string,
  ) {
    const { userId, email } =
      await this.auth.requireAccountIdentity(authorization);
    const preferences = parsePreferences(body);
    if (!email && (preferences.morningBrief || preferences.breakingNews)) {
      throw new BadRequestException('A verified email is required for updates');
    }
    const due = preferences.morningBrief
      ? nextBrief(new Date(), preferences.briefTime, preferences.timeZone)
      : null;
    const [saved] = await this.db
      .insert(userPreferences)
      .values({ userId, ...preferences, briefDueAt: due })
      .onConflictDoUpdate({
        target: userPreferences.userId,
        set: {
          ...preferences,
          briefDueAt: sql`case when ${userPreferences.morningBrief} is distinct from excluded.morning_brief
            or ${userPreferences.briefTime} is distinct from excluded.brief_time
            or ${userPreferences.timeZone} is distinct from excluded.time_zone
            then excluded.brief_due_at else ${userPreferences.briefDueAt} end`,
        },
      })
      .returning(fields);
    return { preferences: saved, emailEligible: Boolean(email) };
  }
}
