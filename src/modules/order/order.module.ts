import { Module } from '@nestjs/common';
import { OrderStateMachineService } from './application/services/order-state-machine.service';
import { OrderCacheService } from './application/services/order-cache.service';
import { OrderValidatorService } from './application/services/order-validator.service';
import { OrderTimeoutService } from './application/services/order-timeout.service';
import { OrderMetricsService } from './application/services/order-metrics.service';
import { OrderManagerService } from './application/services/order-manager.service';

@Module({
  providers: [
    OrderStateMachineService,
    OrderCacheService,
    OrderValidatorService,
    OrderTimeoutService,
    OrderMetricsService,
    OrderManagerService,
  ],
  exports: [OrderManagerService],
})
export class OrderModule {}
