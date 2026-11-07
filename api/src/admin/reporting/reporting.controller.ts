import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { eachDay } from './growth-time';
import { GrowthReportService } from './growth-report.service';
import { ReportingAuthGuard, requiredDay } from './reporting-auth.guard';

@Controller('admin/reports')
@UseGuards(ReportingAuthGuard)
export class ReportingController {
  constructor(private readonly reports: GrowthReportService) {}

  @Get('coverage')
  @Header('Cache-Control', 'no-store')
  coverage() {
    return this.reports.coverage();
  }

  @Get('traffic')
  @Header('Cache-Control', 'no-store')
  traffic(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('timezone') timezone?: string,
  ) {
    const [start, end] = range(from, to);
    return this.reports.traffic(start, end, timezone);
  }

  @Get('funnel')
  @Header('Cache-Control', 'no-store')
  funnel(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('groupBy') groupBy?: string,
  ) {
    const [start, end] = range(from, to);
    return this.reports.funnel(start, end, groupBy);
  }

  @Get('compare')
  @Header('Cache-Control', 'no-store')
  compare(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('dimension') dimension?: string,
  ) {
    const [start, end] = range(from, to);
    return this.reports.compare(start, end, dimension);
  }

  @Get('retention')
  @Header('Cache-Control', 'no-store')
  retention(@Query('from') from: string, @Query('to') to: string) {
    const [start, end] = range(from, to);
    return this.reports.funnel(start, end);
  }

  @Get('external')
  @Header('Cache-Control', 'no-store')
  external(
    @Query('family') family: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    const allowed =
      family === 'x' || family === 'revenue' || family === 'token'
        ? family
        : 'x';
    const [start, end] = range(from, to);
    return this.reports.external(allowed, start, end);
  }

  @Get('snapshots')
  @Header('Cache-Control', 'no-store')
  snapshots() {
    return this.reports.snapshots();
  }

  @Get('daily')
  @Header('Cache-Control', 'no-store')
  async daily(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('timezone') timezone: string | undefined,
    @Query('format') format: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const [start, end] = range(from, to);
    const exported = await this.reports.dailyExport(
      start,
      end,
      timezone,
      format === 'csv' ? 'csv' : 'json',
    );
    if (exported.format === 'csv') {
      response.setHeader('Content-Type', 'text/csv; charset=utf-8');
      return exported.body;
    }
    return exported.body;
  }
}

function range(from: string, to: string): [string, string] {
  const start = requiredDay(from, 'from');
  const end = requiredDay(to, 'to');
  bounds(start, end);
  return [start, end];
}

function bounds(from: string, to: string): void {
  try {
    eachDay(from, to);
  } catch (error) {
    throw new BadRequestException(
      error instanceof Error ? error.message : 'bad range',
    );
  }
}
