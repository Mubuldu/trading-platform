import { Injectable, OnApplicationBootstrap, BeforeApplicationShutdown } from '@nestjs/common';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { LifecycleHook } from './lifecycle-hook.interface';
import { ServiceRegistry } from './service-registry';

/**
 * LifecycleManager orchestrates the ordered startup and shutdown of all
 * registered infrastructure services.
 *
 * It sits on top of NestJS's built-in lifecycle hooks to add:
 *  - Priority-ordered startup (database before cache before app logic)
 *  - Reverse-priority shutdown (app logic before cache before database)
 *  - Per-hook error isolation (one failing hook does not skip others)
 *  - Audit trail: logs every start/stop with duration
 *
 * Services register themselves via register() during module initialization
 * (OnModuleInit). The LifecycleManager then drives them in order during
 * onApplicationBootstrap() and beforeApplicationShutdown().
 *
 * Startup failure policy: if any onStart() throws, the error is logged and
 * the remaining hooks still run. The service registry is updated to 'degraded'.
 * The application continues starting — a failing non-critical service should
 * not bring down the entire platform. Critical services should throw during
 * OnModuleInit (before lifecycle hooks run) to abort bootstrap.
 */
@Injectable()
export class LifecycleManager implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly context = LifecycleManager.name;
  private readonly hooks: LifecycleHook[] = [];
  private started = false;

  constructor(
    private readonly logger: AppLoggerService,
    private readonly serviceRegistry: ServiceRegistry,
  ) {}

  register(hook: LifecycleHook): void {
    this.hooks.push(hook);
    this.logger.debug(
      `Lifecycle hook registered: ${hook.serviceName} (priority ${hook.priority})`,
      this.context,
    );
  }

  async onApplicationBootstrap(): Promise<void> {
    const ordered = [...this.hooks].sort((a, b) => b.priority - a.priority);
    this.logger.log(`Starting ${ordered.length} lifecycle hooks in priority order`, this.context);

    for (const hook of ordered) {
      if (!hook.onStart) continue;
      const start = Date.now();
      try {
        await hook.onStart();
        const durationMs = Date.now() - start;
        this.logger.log(`[${hook.serviceName}] started in ${durationMs}ms`, this.context);
        this.serviceRegistry.updateStatus(hook.serviceName, 'healthy');
      } catch (error) {
        const durationMs = Date.now() - start;
        this.logger.error(
          `[${hook.serviceName}] failed to start after ${durationMs}ms: ${
            error instanceof Error ? error.message : String(error)
          }`,
          error instanceof Error ? error.stack : undefined,
          this.context,
        );
        this.serviceRegistry.updateStatus(hook.serviceName, 'degraded');
      }
    }

    this.started = true;
    this.logger.log('All lifecycle hooks completed startup sequence', this.context);
  }

  async beforeApplicationShutdown(signal?: string): Promise<void> {
    const ordered = [...this.hooks].sort((a, b) => a.priority - b.priority);
    this.logger.log(
      `Shutting down ${ordered.length} lifecycle hooks (signal: ${signal ?? 'none'})`,
      this.context,
    );

    for (const hook of ordered) {
      if (!hook.onStop) continue;
      this.serviceRegistry.updateStatus(hook.serviceName, 'stopping');
      const start = Date.now();
      try {
        await hook.onStop();
        const durationMs = Date.now() - start;
        this.logger.log(`[${hook.serviceName}] stopped in ${durationMs}ms`, this.context);
        this.serviceRegistry.updateStatus(hook.serviceName, 'stopped');
      } catch (error) {
        const durationMs = Date.now() - start;
        this.logger.error(
          `[${hook.serviceName}] failed to stop cleanly after ${durationMs}ms: ${
            error instanceof Error ? error.message : String(error)
          }`,
          error instanceof Error ? error.stack : undefined,
          this.context,
        );
        this.serviceRegistry.updateStatus(hook.serviceName, 'stopped');
      }
    }

    this.logger.log('Shutdown sequence complete', this.context);
  }

  get isStarted(): boolean {
    return this.started;
  }

  get registeredHooks(): string[] {
    return this.hooks.map((h) => h.serviceName);
  }
}
