/**
 * LifecycleHook is implemented by any service that needs ordered startup
 * and shutdown beyond NestJS's built-in onModuleInit/onModuleDestroy.
 *
 * Priority ordering:
 *  Startup:  highest priority runs FIRST (e.g. database: 100, cache: 80, app: 10)
 *  Shutdown: lowest priority runs FIRST (reverse of startup — app shuts down
 *            before cache, cache before database)
 *
 * onStart() and onStop() must be idempotent — the lifecycle manager may call
 * them even if the service failed to initialize, to ensure cleanup runs.
 */
export interface LifecycleHook {
  readonly serviceName: string;
  readonly priority: number;
  onStart?(): Promise<void>;
  onStop?(): Promise<void>;
}
