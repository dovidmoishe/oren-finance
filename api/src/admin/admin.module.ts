import { Module } from '@nestjs/common';
import { AdminAuthController } from './auth/admin-auth.controller';
import { AdminAuthRepository } from './auth/admin-auth.repository';
import { AdminAuthService } from './auth/admin-auth.service';
import { GrowthAccessService } from './reporting/growth-access.service';
import { GrowthCollectController } from './reporting/growth-collect.controller';
import { GrowthGeoService } from './reporting/growth-geo.service';
import { GrowthRecorder } from './reporting/growth-recorder.service';
import { GrowthReportService } from './reporting/growth-report.service';
import { GrowthRepository } from './reporting/growth.repository';
import { GrowthRollupService } from './reporting/growth-rollup.service';
import { ReportingAuthGuard } from './reporting/reporting-auth.guard';
import { ReportingController } from './reporting/reporting.controller';
import { DashboardController } from './dashboard/dashboard.controller';
import { DashboardRepository } from './dashboard/dashboard.repository';

/** Visit collection and read-only reports. Report reads are not an admin grant. */
@Module({
  controllers: [
    GrowthCollectController,
    ReportingController,
    AdminAuthController,
    DashboardController,
  ],
  providers: [
    GrowthRepository,
    GrowthRecorder,
    GrowthReportService,
    GrowthRollupService,
    GrowthGeoService,
    GrowthAccessService,
    ReportingAuthGuard,
    AdminAuthRepository,
    AdminAuthService,
    DashboardRepository,
  ],
  exports: [GrowthRecorder],
})
export class AdminModule {}
