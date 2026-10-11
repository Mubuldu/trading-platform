/**
 * INFRASTRUCTURE_TOKENS are the DI injection keys for all provider abstractions.
 *
 * Rule: every module that depends on infrastructure MUST inject via these tokens,
 * never via the concrete class name. This is what makes providers swappable.
 *
 * Pattern:
 *   constructor(
 *     @Inject(INFRASTRUCTURE_TOKENS.CACHE_PROVIDER)
 *     private readonly cache: CacheProvider,
 *   ) {}
 *
 * Swapping implementations: change the `useClass` in InfrastructureModule.
 * Zero changes to any caller.
 */
export const INFRASTRUCTURE_TOKENS = {
  DATABASE_PROVIDER: Symbol('DatabaseProvider'),
  CACHE_PROVIDER: Symbol('CacheProvider'),
  EVENT_BUS: Symbol('EventBusProvider'),
  STORAGE_PROVIDER: Symbol('StorageProvider'),
  LOCK_PROVIDER: Symbol('LockProvider'),
  QUEUE_PROVIDER: Symbol('QueueProvider'),
  NOTIFICATION_PROVIDER: Symbol('NotificationProvider'),
  SECRETS_PROVIDER: Symbol('SecretsProvider'),
  HEALTH_CHECK_REGISTRY: Symbol('HealthCheckRegistry'),
  SERVICE_REGISTRY: Symbol('ServiceRegistry'),
  LIFECYCLE_MANAGER: Symbol('LifecycleManager'),
  CONNECTION_MANAGER: Symbol('ConnectionManager'),
  BACKGROUND_TASK_MANAGER: Symbol('BackgroundTaskManager'),
} as const;
