import { Controller, Get, Param, Query } from '@nestjs/common';
import type {
  GetPortfolioActivityResponse,
  GetPortfolioCalendarDayResponse,
  GetPortfolioCalendarQuery,
  GetPortfolioCalendarResponse,
  GetPortfolioHistoryResponse,
  GetPortfolioResponse,
} from '../../types/api';
import { WalletAddressPipe } from '../common/pipes/wallet-address.pipe';
import { PortfolioCalendarService } from './portfolio-calendar.service';
import { PortfolioService } from './portfolio.service';

@Controller('portfolio')
export class PortfolioController {
  constructor(
    private readonly portfolio: PortfolioService,
    private readonly calendar: PortfolioCalendarService,
  ) {}

  @Get(':wallet')
  getPortfolio(
    @Param('wallet', WalletAddressPipe) wallet: string,
  ): Promise<GetPortfolioResponse> {
    return this.portfolio.getPortfolio(wallet);
  }

  @Get(':wallet/history')
  getHistory(
    @Param('wallet', WalletAddressPipe) wallet: string,
  ): Promise<GetPortfolioHistoryResponse> {
    return this.portfolio.getHistory(wallet);
  }

  @Get(':wallet/activity')
  getActivity(
    @Param('wallet', WalletAddressPipe) wallet: string,
  ): Promise<GetPortfolioActivityResponse> {
    return this.portfolio.getActivity(wallet);
  }

  @Get(':wallet/calendar')
  getCalendar(
    @Param('wallet', WalletAddressPipe) wallet: string,
    @Query() query: GetPortfolioCalendarQuery,
  ): Promise<GetPortfolioCalendarResponse> {
    return this.calendar.getCalendar(wallet, query);
  }

  @Get(':wallet/calendar/:date')
  getCalendarDay(
    @Param('wallet', WalletAddressPipe) wallet: string,
    @Param('date') date: string,
    @Query() query: Pick<GetPortfolioCalendarQuery, 'timeZone'>,
  ): Promise<GetPortfolioCalendarDayResponse> {
    return this.calendar.getDay(wallet, date, query);
  }
}
