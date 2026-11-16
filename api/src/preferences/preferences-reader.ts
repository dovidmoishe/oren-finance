import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { isInterestId, type InterestId } from '../../types/sectors';
import { DRIZZLE } from '../config/constants';
import type { Database } from '../database/database.provider';
import { userPreferences } from '../database/schema';

@Injectable()
export class PreferencesReader {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  // Keep the stored field and method name compatible with existing accounts.
  async getSectors(userId: string): Promise<InterestId[]> {
    const [row] = await this.db
      .select({ sectors: userPreferences.sectors })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId));
    return row?.sectors.filter(isInterestId) ?? [];
  }
}
