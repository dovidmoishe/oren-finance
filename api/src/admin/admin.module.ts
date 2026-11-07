import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GrowthAccessService } from './reporting/growth-access.service';
import { GrowthCollectController } from './reporting/growth-collect.controller';
import { GrowthImportController } from './reporting/growth-import.controller';
import { GrowthRecorder } from './reporting/growth-recorder.service';
import { GrowthReportService } from './reporting/growth-report.service';
import { GrowthRepository } from './reporting/growth.repository';
import { GrowthRollupService } from './reporting/growth-rollup.service';
import { ReportingAuthGuard } from './reporting/reporting-auth.guard';
import { ReportingController } from './reporting/reporting.controller';

/** Read-only marketing reports and visit collection. Not a trade-admin surface. */
@Module({
  imports: [AuthModule],
  controllers: [
    GrowthCollectController,
    ReportingController,
    GrowthImportController,
  ],
  providers: [
    GrowthRepository,
    GrowthRecorder,
    GrowthReportService,
    GrowthRollupService,
    GrowthAccessService,
    ReportingAuthGuard,
  ],
  exports: [GrowthRecorder],
})
export class AdminModule {}
