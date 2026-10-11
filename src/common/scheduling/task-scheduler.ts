import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'crypto';

interface ScheduledTask {
  id: string;
  name: string;
  type: 'once' | 'recurring';
  handle: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>;
}

/**
 * TaskScheduler manages in-process scheduled tasks with a clean lifecycle.
 *
 * Use when: a module needs periodic work (heartbeats, cache invalidation, metric
 * flushing) without introducing a full job queue dependency.
 *
 * Do NOT use for: distributed scheduling, persistence across restarts, or tasks
 * that must survive process crashes. Use a dedicated queue (Bull, BullMQ) for
 * those requirements.
 *
 * Errors thrown inside scheduled tasks are caught and swallowed. The caller
 * must pass an error handler if they need to react to task failures.
 * Not doing so prevents a misbehaving task from crashing the entire process.
 *
 * Graceful shutdown: onModuleDestroy() cancels all pending tasks. NestJS calls
 * this automatically when SIGTERM/SIGINT is received (enableShutdownHooks).
 */
@Injectable()
export class TaskScheduler implements OnModuleDestroy {
  private readonly tasks = new Map<string, ScheduledTask>();

  scheduleOnce(
    name: string,
    fn: () => Promise<void>,
    delayMs: number,
    onError?: (error: unknown) => void,
  ): string {
    const id = randomUUID();
    const handle = setTimeout(() => {
      this.tasks.delete(id);
      void fn().catch((error: unknown) => onError?.(error));
    }, delayMs);

    this.tasks.set(id, { id, name, type: 'once', handle });
    return id;
  }

  scheduleRecurring(
    name: string,
    fn: () => Promise<void>,
    intervalMs: number,
    onError?: (error: unknown) => void,
  ): string {
    const id = randomUUID();
    const handle = setInterval(() => {
      void fn().catch((error: unknown) => onError?.(error));
    }, intervalMs);

    this.tasks.set(id, { id, name, type: 'recurring', handle });
    return id;
  }

  cancel(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task) return false;

    if (task.type === 'once') {
      clearTimeout(task.handle as ReturnType<typeof setTimeout>);
    } else {
      clearInterval(task.handle as ReturnType<typeof setInterval>);
    }

    this.tasks.delete(id);
    return true;
  }

  cancelAll(): void {
    for (const id of this.tasks.keys()) {
      this.cancel(id);
    }
  }

  get activeTasks(): string[] {
    return Array.from(this.tasks.values()).map((t) => `${t.name} [${t.type}]`);
  }

  onModuleDestroy(): void {
    this.cancelAll();
  }
}
