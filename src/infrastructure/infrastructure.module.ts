import { Global, Inject, Module, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '@config/app.config';
import { SecretsConfig } from '@config/secrets.config';
import { ClusterConfig } from '@config/cluster.config';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { TaskScheduler } from '@common/scheduling/task-scheduler';
import { RedisModule } from './redis/redis.module';
import { DatabaseModule } from './database/database.module';
import { PgDatabaseManager } from './database/connection/pg-database-manager.service';
import { DatabaseHealthService } from './database/health/database-health.service';
import { ClusterModule } from './cluster/cluster.module';

import { INFRASTRUCTURE_TOKENS } from './infrastructure.tokens';

// Provider interfaces
import { DatabaseProvider } from './providers/database/database-provider.interface';
import { CacheProvider } from './providers/cache/cache-provider.interface';
import { EventBusProvider } from './providers/event-bus/event-bus.interface';
import { StorageProvider } from './providers/storage/storage-provider.interface';
import { LockProvider } from './providers/lock/lock-provider.interface';
import { QueueProvider } from './providers/queue/queue-provider.interface';
import { NotificationProvider } from './providers/notification/notification-provider.interface';
import { SecretsProvider } from './providers/secrets/secrets-provider.interface';

// Provider implementations
import { InMemoryCacheProvider } from './providers/cache/in-memory-cache.provider';
import { RedisCacheProvider } from './providers/cache/redis-cache.provider';
import { InMemoryEventBusProvider } from './providers/event-bus/in-memory-event-bus.provider';
import { NoopStorageProvider } from './providers/storage/noop-storage.provider';
import { InMemoryLockProvider } from './providers/lock/in-memory-lock.provider';
import { RedisLockProvider } from './providers/lock/redis-lock.provider';
import { InMemoryQueueProvider } from './providers/queue/in-memory-queue.provider';
import { RedisQueueProvider } from './providers/queue/redis-queue.provider';
import { NoopNotificationProvider } from './providers/notification/noop-notification.provider';
import { EnvSecretsProvider } from './providers/secrets/env-secrets.provider';
import { DockerSecretsProvider } from './providers/secrets/docker-secrets.provider';
import { RedisClientService } from './redis/redis-client.service';

// Infrastructure core
import { HealthCheckRegistry } from './health/health-check-registry';
import { ServiceRegistry } from './lifecycle/service-registry';
import { LifecycleManager } from './lifecycle/lifecycle.manager';
import { ConnectionManager } from './connection/connection.manager';
import { BackgroundTaskManager } from './background/background-task-manager';

/**
 * InfrastructureModule wires all provider interfaces to their implementations
 * and registers core infrastructure services as global singletons.
 *
 * Dependency graph:
 *
 *   InfrastructureModule
 *     ├── HealthCheckRegistry    (health aggregation)
 *     ├── ServiceRegistry        (service status tracking)
 *     ├── LifecycleManager       (ordered start/stop)
 *     ├── ConnectionManager      (database connection lifecycle)
 *     ├── BackgroundTaskManager  (recurring task lifecycle)
 *     ├── TaskScheduler          (in-process timer management)
 *     └── Providers (via tokens)
 *           ├── DATABASE_PROVIDER → NoopDatabaseProvider
 *           ├── CACHE_PROVIDER    → InMemoryCacheProvider
 *           ├── EVENT_BUS         → InMemoryEventBusProvider
 *           ├── STORAGE_PROVIDER  → NoopStorageProvider
 *           ├── LOCK_PROVIDER     → InMemoryLockProvider
 *           ├── QUEUE_PROVIDER    → InMemoryQueueProvider
 *           ├── NOTIFICATION_PROVIDER → NoopNotificationProvider
 *           └── SECRETS_PROVIDER  → EnvSecretsProvider
 *
 * Swapping an implementation: change `useClass` for the relevant token.
 * No other code changes are needed.
 *
 * onModuleInit() registers all providers with the HealthCheckRegistry and
 * the LifecycleManager, and registers the platform service in the ServiceRegistry.
 */
/**
 * Provider selection: single-node vs cluster mode.
 *
 * When cluster.enabled=false (default), in-memory providers are used — zero
 * external dependencies, perfect for development and single-instance production.
 *
 * When cluster.enabled=true, the three providers that must be shared across
 * processes are replaced with Redis-backed implementations:
 *   CACHE_PROVIDER  → RedisCacheProvider   (shared key-value store)
 *   LOCK_PROVIDER   → RedisLockProvider    (distributed mutual exclusion)
 *   QUEUE_PROVIDER  → RedisQueueProvider   (distributed task queuing)
 *
 * No business logic changes are needed. All callers inject via INFRASTRUCTURE_TOKENS
 * and remain unaware of the underlying implementation.
 */
function cacheProviderFactory(
  configService: ConfigService,
  redis: RedisClientService,
  logger: AppLoggerService,
): CacheProvider {
  const cfg = configService.get<ClusterConfig>('cluster')!;
  if (cfg.enabled) {
    return new RedisCacheProvider(redis, logger);
  }
  return new InMemoryCacheProvider();
}

function lockProviderFactory(
  configService: ConfigService,
  redis: RedisClientService,
  logger: AppLoggerService,
): LockProvider {
  const cfg = configService.get<ClusterConfig>('cluster')!;
  if (cfg.enabled) {
    return new RedisLockProvider(redis, configService, logger);
  }
  return new InMemoryLockProvider();
}

function queueProviderFactory(
  configService: ConfigService,
  redis: RedisClientService,
  logger: AppLoggerService,
): QueueProvider {
  const cfg = configService.get<ClusterConfig>('cluster')!;
  if (cfg.enabled) {
    return new RedisQueueProvider(redis, logger);
  }
  return new InMemoryQueueProvider(logger);
}

@Global()
@Module({
  imports: [RedisModule, DatabaseModule, ClusterModule],
  providers: [
    TaskScheduler,
    HealthCheckRegistry,
    ServiceRegistry,
    LifecycleManager,
    ConnectionManager,
    BackgroundTaskManager,
    { provide: INFRASTRUCTURE_TOKENS.DATABASE_PROVIDER, useClass: PgDatabaseManager },
    {
      provide: INFRASTRUCTURE_TOKENS.CACHE_PROVIDER,
      useFactory: cacheProviderFactory,
      inject: [ConfigService, RedisClientService, AppLoggerService],
    },
    { provide: INFRASTRUCTURE_TOKENS.EVENT_BUS, useClass: InMemoryEventBusProvider },
    { provide: INFRASTRUCTURE_TOKENS.STORAGE_PROVIDER, useClass: NoopStorageProvider },
    {
      provide: INFRASTRUCTURE_TOKENS.LOCK_PROVIDER,
      useFactory: lockProviderFactory,
      inject: [ConfigService, RedisClientService, AppLoggerService],
    },
    {
      provide: INFRASTRUCTURE_TOKENS.QUEUE_PROVIDER,
      useFactory: queueProviderFactory,
      inject: [ConfigService, RedisClientService, AppLoggerService],
    },
    { provide: INFRASTRUCTURE_TOKENS.NOTIFICATION_PROVIDER, useClass: NoopNotificationProvider },
    {
      provide: INFRASTRUCTURE_TOKENS.SECRETS_PROVIDER,
      useFactory: (configService: ConfigService): SecretsProvider => {
        const cfg = configService.get<SecretsConfig>('secrets')!;
        if (cfg.provider === 'docker') {
          return new DockerSecretsProvider(cfg.dockerSecretsPath);
        }
        return new EnvSecretsProvider();
      },
      inject: [ConfigService],
    },
  ],
  exports: [
    RedisModule,
    ClusterModule,
    TaskScheduler,
    HealthCheckRegistry,
    ServiceRegistry,
    LifecycleManager,
    ConnectionManager,
    BackgroundTaskManager,
    INFRASTRUCTURE_TOKENS.DATABASE_PROVIDER,
    INFRASTRUCTURE_TOKENS.CACHE_PROVIDER,
    INFRASTRUCTURE_TOKENS.EVENT_BUS,
    INFRASTRUCTURE_TOKENS.STORAGE_PROVIDER,
    INFRASTRUCTURE_TOKENS.LOCK_PROVIDER,
    INFRASTRUCTURE_TOKENS.QUEUE_PROVIDER,
    INFRASTRUCTURE_TOKENS.NOTIFICATION_PROVIDER,
    INFRASTRUCTURE_TOKENS.SECRETS_PROVIDER,
  ],
})
export class InfrastructureModule implements OnModuleInit {
  private readonly context = InfrastructureModule.name;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: AppLoggerService,
    private readonly healthRegistry: HealthCheckRegistry,
    private readonly lifecycleManager: LifecycleManager,
    private readonly serviceRegistry: ServiceRegistry,
    private readonly connectionManager: ConnectionManager,
    private readonly dbHealth: DatabaseHealthService,
    @Inject(INFRASTRUCTURE_TOKENS.DATABASE_PROVIDER) private readonly db: DatabaseProvider,
    @Inject(INFRASTRUCTURE_TOKENS.CACHE_PROVIDER) private readonly cache: CacheProvider,
    @Inject(INFRASTRUCTURE_TOKENS.EVENT_BUS) private readonly eventBus: EventBusProvider,
    @Inject(INFRASTRUCTURE_TOKENS.STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(INFRASTRUCTURE_TOKENS.LOCK_PROVIDER) private readonly lock: LockProvider,
    @Inject(INFRASTRUCTURE_TOKENS.QUEUE_PROVIDER) private readonly queue: QueueProvider,
    @Inject(INFRASTRUCTURE_TOKENS.NOTIFICATION_PROVIDER)
    private readonly notifications: NotificationProvider,
    @Inject(INFRASTRUCTURE_TOKENS.SECRETS_PROVIDER) private readonly secrets: SecretsProvider,
  ) {}

  onModuleInit(): void {
    this.registerServiceEntry();
    this.registerHealthChecks();
    this.registerLifecycleHooks();
    this.logger.log('InfrastructureModule initialized', this.context);
  }

  private registerServiceEntry(): void {
    this.serviceRegistry.register({
      name: 'trading-platform',
      version: this.configService.get<AppConfig>('app')!.version,
      capabilities: ['trading', 'market-data', 'risk-management'],
      startedAt: new Date(),
      status: 'starting',
    });

    [
      'database',
      'cache',
      'event-bus',
      'storage',
      'lock',
      'queue',
      'notifications',
      'secrets',
    ].forEach((svc) => {
      this.serviceRegistry.register({
        name: svc,
        version: '1.0.0',
        capabilities: [svc],
        startedAt: new Date(),
        status: 'starting',
      });
    });
  }

  private registerHealthChecks(): void {
    this.healthRegistry.register({ name: 'database', check: () => this.dbHealth.getHealth() });
    this.healthRegistry.register({ name: 'cache', check: () => this.cache.getHealth() });
    this.healthRegistry.register({ name: 'event-bus', check: () => this.eventBus.getHealth() });
    this.healthRegistry.register({ name: 'storage', check: () => this.storage.getHealth() });
    this.healthRegistry.register({ name: 'lock', check: () => this.lock.getHealth() });
    this.healthRegistry.register({ name: 'queue', check: () => this.queue.getHealth() });
    this.healthRegistry.register({
      name: 'notifications',
      check: () => this.notifications.getHealth(),
    });
    this.healthRegistry.register({ name: 'secrets', check: () => this.secrets.getHealth() });
  }

  private registerLifecycleHooks(): void {
    this.lifecycleManager.register({
      serviceName: 'database',
      priority: 100,
      onStart: async () => {
        this.connectionManager.register('primary', this.db);
        await this.connectionManager.connectAll();
        this.serviceRegistry.updateStatus('database', 'healthy');
      },
      onStop: async () => {
        await this.connectionManager.disconnectAll();
        this.serviceRegistry.updateStatus('database', 'stopped');
      },
    });

    this.lifecycleManager.register({
      serviceName: 'trading-platform',
      priority: 10,
      onStart: async () => {
        this.serviceRegistry.updateStatus('trading-platform', 'healthy');
      },
      onStop: async () => {
        this.serviceRegistry.updateStatus('trading-platform', 'stopping');
      },
    });
  }
}
