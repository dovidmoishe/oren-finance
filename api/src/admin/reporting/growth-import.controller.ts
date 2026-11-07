import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  contentHash,
  validateImport,
  type GrowthImportDocument,
} from './growth-import';
import { GrowthRepository } from './growth.repository';
import {
  RequiresReportPermission,
  ReportingAuthGuard,
} from './reporting-auth.guard';

@Controller('admin/imports')
@UseGuards(ReportingAuthGuard)
export class GrowthImportController {
  constructor(private readonly repository: GrowthRepository) {}

  @Post('aggregates')
  @RequiresReportPermission('marketing.import')
  @HttpCode(200)
  async aggregates(@Body() body: unknown) {
    const document = body as GrowthImportDocument;
    try {
      validateImport(document);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid import',
      );
    }
    const hash = contentHash(document);
    const status = await this.repository.insertImport(document, hash);
    return {
      status,
      observations: document.observations.length,
      fabricatedVisits: 0,
    };
  }
}
