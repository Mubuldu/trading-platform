import { Module } from '@nestjs/common';
import { StrategyModule } from '@modules/strategy/strategy.module';
import { IndicatorRegistryService } from './infrastructure/registry/indicator-registry.service';
import { CandleValidatorService } from './infrastructure/validators/candle-validator.service';
import { IndicatorPublisherService } from './infrastructure/publishers/indicator-publisher.service';
import { KlineConsumerService } from './infrastructure/consumers/kline-consumer.service';
import { WarmupService } from './application/services/warmup.service';
import { IndicatorOrchestratorService } from './application/services/indicator-orchestrator.service';

@Module({
  imports: [StrategyModule], // provides StrategySchedulerService → KlineConsumerService
  providers: [
    IndicatorRegistryService,
    CandleValidatorService,
    IndicatorPublisherService,
    KlineConsumerService,
    WarmupService,
    IndicatorOrchestratorService,
  ],
  exports: [IndicatorRegistryService, IndicatorPublisherService],
})
export class IndicatorModule {}
