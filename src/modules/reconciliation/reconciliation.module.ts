import { Module } from '@nestjs/common';
import { ExchangeModule } from '@modules/exchange/exchange.module';
import { RiskModule } from '@modules/risk/risk.module';
import { PositionModule } from '@modules/position/position.module';
import { OrderModule } from '@modules/order/order.module';
import { ReconciliationMetricsService } from './application/services/reconciliation-metrics.service';
import { ReconciliationAuditService } from './application/services/reconciliation-audit.service';
import { PositionReconcilerService } from './application/services/position-reconciler.service';
import { OrderReconcilerService } from './application/services/order-reconciler.service';
import { RecoveryService } from './application/services/recovery.service';
import { ReconciliationSchedulerService } from './application/services/reconciliation-scheduler.service';

@Module({
  imports: [ExchangeModule, RiskModule, PositionModule, OrderModule],
  providers: [
    ReconciliationMetricsService,
    ReconciliationAuditService,
    PositionReconcilerService,
    OrderReconcilerService,
    RecoveryService,
    ReconciliationSchedulerService,
  ],
  exports: [ReconciliationSchedulerService],
})
export class ReconciliationModule {}
