import { Module } from '@nestjs/common';
import { PositionValidatorService } from './application/services/position-validator.service';
import { PnlCalculatorService } from './application/services/pnl-calculator.service';
import { PositionStateMachineService } from './application/services/position-state-machine.service';
import { PositionCacheService } from './application/services/position-cache.service';
import { PositionManagerService } from './application/services/position-manager.service';

@Module({
  providers: [
    PositionValidatorService,
    PnlCalculatorService,
    PositionStateMachineService,
    PositionCacheService,
    PositionManagerService,
  ],
  exports: [PositionManagerService],
})
export class PositionModule {}
