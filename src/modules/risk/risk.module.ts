import { Module } from '@nestjs/common';
import { AlertsModule } from '@modules/alerts/alerts.module';
import { RiskStateService } from './application/services/risk-state.service';
import { EmergencyProtectionService } from './application/services/emergency-protection.service';
import { TradeValidatorService } from './application/services/trade-validator.service';
import { PortfolioLimitsService } from './application/services/portfolio-limits.service';
import { DailyLimitsService } from './application/services/daily-limits.service';
import { DynamicRiskReducerService } from './application/services/dynamic-risk-reducer.service';
import { PositionSizingService } from './application/services/position-sizing.service';
import { RiskEngineService } from './application/services/risk-engine.service';

@Module({
  imports: [AlertsModule],
  providers: [
    RiskStateService,
    EmergencyProtectionService,
    TradeValidatorService,
    PortfolioLimitsService,
    DailyLimitsService,
    DynamicRiskReducerService,
    PositionSizingService,
    RiskEngineService,
  ],
  exports: [RiskEngineService, RiskStateService],
})
export class RiskModule {}
