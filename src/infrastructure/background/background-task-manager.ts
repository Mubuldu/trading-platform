import { Injectable, OnApplicationBootstrap, BeforeApplicationShutdown } from '@nestjs/common';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { TaskScheduler } from '@common/scheduling/task-scheduler';

export interface BackgroundTaskDefinition {
  readonly name: string;
  readonly fn: () => Promise<void>;
  readonly intervalMs: number;
  readonly runImmediately?: boolean;
  readonly onError?: (error: unknown, taskName: string) => void;
}

/**
 * BackgroundTaskManager owns the lifecycle of recurring background tasks.
 *
 * Tasks are registered during module initialization via register(), then
 * started only after onApplicationBootstrap() fires — ensuring the
 * application is fully ready before any background work begins.
 *
 * This prevents the following class of bugs:
 *  - A background task runs before the database connects
 *  - A background task reads config that isn't loaded yet
 *  - A task fires during shutdown while resources are being released
 *
 * Error isolation: each task's error handler is invoked independently.
 * A crashing task does not cancel other tasks. Default error handler
 * logs the error and allows the task to be retried on the next interval.
 *
 * Graceful shutdown: beforeApplicationShutdown() cancels all tasks,
 * preventing in-flight work from interfering with connection teardown.
 */
@Injectable()
export class BackgroundTaskManager implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly context = BackgroundTaskManager.name;
  private readonly definitions: BackgroundTaskDefinition[] = [];
  private readonly activeIds = new Map<string, string>();

  constructor(
    private readonly taskScheduler: TaskScheduler,
    private readonly logger: AppLoggerService,
  ) {}

  register(definition: BackgroundTaskDefinition): void {
    if (this.definitions.some((d) => d.name === definition.name)) {
      throw new Error(`Background task "${definition.name}" is already registered`);
    }
    this.definitions.push(definition);
    this.logger.debug(
      `Background task registered: ${definition.name} (${definition.intervalMs}ms)`,
      this.context,
    );
  }

  onApplicationBootstrap(): void {
    for (const task of this.definitions) {
      const errorHandler = (error: unknown): void => {
        const handler = task.onError ?? this.defaultErrorHandler.bind(this);
        handler(error, task.name);
      };

      const id = this.taskScheduler.scheduleRecurring(
        task.name,
        task.fn,
        task.intervalMs,
        errorHandler,
      );
      this.activeIds.set(task.name, id);

      if (task.runImmediately) {
        task.fn().catch((e) => errorHandler(e));
      }

      this.logger.log(
        `Background task started: ${task.name} (${task.intervalMs}ms interval)`,
        this.context,
      );
    }
  }

  beforeApplicationShutdown(): void {
    for (const [name, id] of this.activeIds) {
      this.taskScheduler.cancel(id);
      this.logger.log(`Background task stopped: ${name}`, this.context);
    }
    this.activeIds.clear();
  }

  cancel(name: string): boolean {
    const id = this.activeIds.get(name);
    if (!id) return false;
    const cancelled = this.taskScheduler.cancel(id);
    if (cancelled) {
      this.activeIds.delete(name);
      this.logger.log(`Background task cancelled: ${name}`, this.context);
    }
    return cancelled;
  }

  get activeTaskNames(): string[] {
    return [...this.activeIds.keys()];
  }

  get registeredTaskNames(): string[] {
    return this.definitions.map((d) => d.name);
  }

  private defaultErrorHandler(error: unknown, taskName: string): void {
    this.logger.error(
      `Background task "${taskName}" failed: ${error instanceof Error ? error.message : String(error)}`,
      error instanceof Error ? error.stack : undefined,
      this.context,
    );
  }
}
