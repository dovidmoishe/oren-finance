import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import type { Response } from 'express';
import type {
  MarketDayRecap,
  MarketEventsResponse,
  UsEquityClosuresResponse,
  UsEquityHours,
  UsEquitySessionMode,
  UsEquitySessionResponse,
  UsEquityTradingDayResponse,
} from '../../../types/market-calendar';
import {
  MarketCalendarService,
  parseEventKinds,
} from './market-calendar.service';
import {
  FIRST_SUPPORTED_YEAR,
  LAST_SUPPORTED_YEAR,
  UsEquityCalendarRangeError,
  usEquityCalendar,
} from './us-equity-calendar';
import { UsEquityCalendarService } from './us-equity-calendar.service';
import { MarketDayRecapService } from './market-day-recap.service';

const LIVE_CACHE = 'public, max-age=30';
const STABLE_CACHE = 'public, max-age=3600, stale-while-revalidate=86400';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MESSAGE = 'must be a New York date in YYYY-MM-DD form';

class SessionQueryDto {
  @IsOptional()
  @IsString()
  at?: string;

  @IsOptional()
  @IsIn(['regular', 'extended', 'any'])
  session?: UsEquitySessionMode;
}

class HoursQueryDto {
  @Matches(DATE, { message: `date ${DATE_MESSAGE}` })
  date!: string;
}

class ClosuresQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(FIRST_SUPPORTED_YEAR)
  @Max(LAST_SUPPORTED_YEAR)
  year!: number;
}

class TradingDayQueryDto {
  @Matches(DATE, { message: `date ${DATE_MESSAGE}` })
  date!: string;

  @IsOptional()
  @IsIn(['next', 'previous'])
  direction?: 'next' | 'previous';
}

class EventsQueryDto {
  @Matches(DATE, { message: `from ${DATE_MESSAGE}` })
  from!: string;

  @Matches(DATE, { message: `to ${DATE_MESSAGE}` })
  to!: string;

  @IsOptional()
  @IsString()
  kinds?: string;
}

/** A calendar range error is the caller's input, never a server fault. */
function answer<T>(work: () => T): T {
  try {
    return work();
  } catch (error) {
    if (error instanceof UsEquityCalendarRangeError)
      throw new BadRequestException(error.message);
    throw error;
  }
}

/**
 * Public, read-only US equity cash-session hours. These describe the NYSE
 * session, not whether a tokenized stock can be swapped on-chain right now.
 */
@Controller('markets')
export class MarketHoursController {
  constructor(
    private readonly hours: UsEquityCalendarService,
    private readonly calendar: MarketCalendarService,
  ) {}

  @Get('session')
  session(
    @Query() query: SessionQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): UsEquitySessionResponse {
    const result = answer(() =>
      this.calendar.isMarketOpen({ at: query.at, session: query.session }),
    );
    res.setHeader('Cache-Control', query.at ? STABLE_CACHE : LIVE_CACHE);
    return result;
  }

  @Get('hours')
  @Header('Cache-Control', STABLE_CACHE)
  getHours(@Query() query: HoursQueryDto): UsEquityHours {
    return answer(() => this.hours.getHours(query.date));
  }

  @Get('closures')
  @Header('Cache-Control', STABLE_CACHE)
  closures(@Query() query: ClosuresQueryDto): UsEquityClosuresResponse {
    return answer(() => this.hours.getClosures(query.year));
  }

  @Get('trading-day')
  @Header('Cache-Control', STABLE_CACHE)
  tradingDay(@Query() query: TradingDayQueryDto): UsEquityTradingDayResponse {
    return answer(() =>
      this.hours.getTradingDay(query.date, query.direction ?? 'next'),
    );
  }
}

/** Public, read-only official US macro releases, read from Postgres only. */
@Controller('calendar')
export class MarketCalendarController {
  constructor(
    private readonly calendar: MarketCalendarService,
    private readonly recaps: MarketDayRecapService,
  ) {}

  /**
   * What happened in US markets on one New York date. Finished days are
   * stable; today and future days change as prices and releases land.
   */
  @Get('days/:date')
  async day(
    @Param('date') date: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MarketDayRecap> {
    if (!DATE.test(date)) throw new BadRequestException(`date ${DATE_MESSAGE}`);
    try {
      const recap = await this.recaps.getRecap(date);
      // Settled once the New York day is over; until then prices and headlines move.
      const settled =
        recap.date < usEquityCalendar.etDate(new Date(recap.generatedAt));
      res.setHeader('Cache-Control', settled ? STABLE_CACHE : LIVE_CACHE);
      return recap;
    } catch (error) {
      if (error instanceof UsEquityCalendarRangeError)
        throw new BadRequestException(error.message);
      throw error;
    }
  }

  @Get('events')
  @Header('Cache-Control', STABLE_CACHE)
  async events(@Query() query: EventsQueryDto): Promise<MarketEventsResponse> {
    const kinds = answer(() => parseEventKinds(query.kinds));
    try {
      return await this.calendar.getEvents({
        from: query.from,
        to: query.to,
        kinds,
      });
    } catch (error) {
      if (error instanceof UsEquityCalendarRangeError)
        throw new BadRequestException(error.message);
      throw error;
    }
  }
}
