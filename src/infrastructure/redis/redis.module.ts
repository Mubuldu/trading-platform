import { Global, Module, OnModuleInit } from '@nestjs/common';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { HealthCheckRegistry } from '@infrastructure/health/health-check-registry';
import { LifecycleManager } from '@infrastructure/lifecycle/lifecycle.manager';
import { ServiceRegistry } from '@infrastructure/lifecycle/service-registry';

import { RedisClientService } from './redis-client.service';
import { RedisHealthProvider } from './health/redis-health.provider';

import { StreamSerializerService } from './streams/stream-serializer.service';
import { StreamValidatorService } from './streams/stream-validator.service';
import { StreamPublisherService } from './streams/stream-publisher.service';
import { StreamConsumerService } from './streams/stream-consumer.service';
import { ConsumerManagerService } from './streams/consumer-manager.service';
import { DeadLetterService } from './streams/dead-letter.service';
import { ReplayService } from './streams/replay.service';
import { RedisHashService } from './hash/redis-hash.service';
import { RedisSortedSetService } from './sorted-set/redis-sorted-set.service';
import { BackpressureMonitorService } from './backpressure/backpressure-monitor.service';

@Global()
@Module({
  providers: [
    RedisClientService,
    RedisHealthProvider,
    StreamSerializerService,
    StreamValidatorService,
    StreamPublisherService,
    StreamConsumerService,
    ConsumerManagerService,
    DeadLetterService,
    ReplayService,
    RedisHashService,
    RedisSortedSetService,
    BackpressureMonitorService,
  ],
  exports: [
    RedisClientService,
    RedisHealthProvider,
    StreamSerializerService,
    StreamValidatorService,
    StreamPublisherService,
    StreamConsumerService,
    ConsumerManagerService,
    DeadLetterService,
    ReplayService,
    RedisHashService,
    RedisSortedSetService,
    BackpressureMonitorService,
  ],
})
export class RedisModule implements OnModuleInit {
  private readonly context = RedisModule.name;

  constructor(
    private readonly redisClient: RedisClientService,
    private readonly redisHealth: RedisHealthProvider,
    private readonly healthRegistry: HealthCheckRegistry,
    private readonly lifecycleManager: LifecycleManager,
    private readonly serviceRegistry: ServiceRegistry,
    private readonly logger: AppLoggerService,
  ) {}

  onModuleInit(): void {
    this.healthRegistry.register({
      name: 'redis',
      check: () => this.redisHealth.getHealth(),
    });

    this.lifecycleManager.register({
      serviceName: 'redis',
      priority: 90,
      onStart: async () => {
        await this.redisClient.connect();
        this.serviceRegistry.register({
          name: 'redis',
          version: '1.0.0',
          capabilities: ['streams', 'hash', 'sorted-set', 'cache'],
          startedAt: new Date(),
          status: 'healthy',
        });
        this.logger.log('Redis event streaming layer started', this.context);
      },
      onStop: async () => {
        await this.redisClient.disconnect();
        this.serviceRegistry.updateStatus('redis', 'stopped');
        this.logger.log('Redis event streaming layer stopped', this.context);
      },
    });

    this.logger.log('RedisModule initialized', this.context);
  }
}
