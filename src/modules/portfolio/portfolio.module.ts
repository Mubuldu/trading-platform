import { Module } from '@nestjs/common';
import { PortfolioMetricsService } from './application/services/portfolio-metrics.service';
import { PortfolioExposureService } from './application/services/portfolio-exposure.service';
import { CapitalAllocationService } from './application/services/capital-allocation.service';
import { PortfolioConstraintsService } from './application/services/portfolio-constraints.service';
import { PortfolioCacheService } from './application/services/portfolio-cache.service';
import { PortfolioManagerService } from './application/services/portfolio-manager.service';

@Module({
  providers: [
    PortfolioMetricsService,
    PortfolioExposureService,
    CapitalAllocationService,
    PortfolioConstraintsService,
    PortfolioCacheService,
    PortfolioManagerService,
  ],
  exports: [PortfolioManagerService],
})
export class PortfolioModule {}
