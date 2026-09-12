import { Controller, Get, Param } from '@nestjs/common';
import type {
  GetPortfolioActivityResponse,
  GetPortfolioHistoryResponse,
  GetPortfolioResponse,
} from '../../types/api';
import { WalletAddressPipe } from '../common/pipes/wallet-address.pipe';
import { PortfolioService } from './portfolio.service';

@Controller('portfolio')
export class PortfolioController {
  constructor(private readonly portfolio: PortfolioService) {}

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
}
