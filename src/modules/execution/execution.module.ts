import { Module } from '@nestjs/common';
import { ExchangeModule } from '@modules/exchange/exchange.module';
import { ExecutionValidatorService } from './application/services/execution-validator.service';
import { OrderRouterService } from './application/services/order-router.service';
import { OrderBuilderService } from './application/services/order-builder.service';
import { RetryManagerService } from './application/services/retry-manager.service';
import { OrderTrackerService } from './application/services/order-tracker.service';
import { FillProcessorService } from './application/services/fill-processor.service';
import { LatencyMonitorService } from './application/services/latency-monitor.service';
import { ExecutionEngineService } from './application/services/execution-engine.service';

@Module({
  imports: [ExchangeModule],
  providers: [
    LatencyMonitorService,
    ExecutionValidatorService,
    OrderRouterService,
    OrderBuilderService,
    RetryManagerService,
    OrderTrackerService,
    FillProcessorService,
    ExecutionEngineService,
  ],
  exports: [ExecutionEngineService, OrderTrackerService],
})
export class ExecutionModule {}
