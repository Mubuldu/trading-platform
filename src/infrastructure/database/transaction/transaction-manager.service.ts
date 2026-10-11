import { Injectable } from '@nestjs/common';
import { CompiledQuery } from 'kysely';
import { IsolationLevel } from '@common/decorators/transactional.decorator';
import { DatabaseError } from '@common/errors/infrastructure.error';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { PgPoolService } from '../connection/pg-pool.service';
import { TransactionContext } from './transaction.context';

export interface TransactionOptions {
  isolationLevel?: IsolationLevel;
  /** Retry the callback up to this many times on serialization failures. */
  maxRetries?: number;
  /** Milliseconds before the transaction is forcefully rolled back. */
  timeoutMs?: number;
}

const SERIALIZATION_ERROR_CODES = new Set(['40001', '40P01']); // serialize failure, deadlock

/**
 * TransactionManager wraps business operations in PostgreSQL transactions.
 *
 * Features:
 *  - Nested transactions via savepoints (REQUIRES propagation).
 *  - Automatic retry on serialization failures (40001) and deadlocks (40P01).
 *  - Configurable isolation level per transaction.
 *  - Timeout cancellation — useful for guarding against runaway queries.
 *  - AsyncLocalStorage propagation — repositories pick up the transaction
 *    automatically via TransactionContext.getCurrent().
 *
 * Usage:
 *   await this.txManager.run(async () => {
 *     await this.orderRepo.save(order);
 *     await this.fillRepo.save(fill);
 *   }, { isolationLevel: 'SERIALIZABLE', maxRetries: 3 });
 */
@Injectable()
export class TransactionManager {
  private readonly context = TransactionManager.name;

  constructor(
    private readonly pool: PgPoolService,
    private readonly logger: AppLoggerService,
  ) {}

  async run<T>(callback: () => Promise<T>, options: TransactionOptions = {}): Promise<T> {
    const { isolationLevel = 'READ_COMMITTED', maxRetries = 0, timeoutMs } = options;

    // If already inside a transaction, join it (nested — use savepoint)
    if (TransactionContext.isActive()) {
      return this.runSavepoint(callback);
    }

    let attempt = 0;

    while (true) {
      try {
        return await this.runNew(callback, isolationLevel, timeoutMs);
      } catch (error) {
        const pgCode = (error as { code?: string })?.code;
        const isRetryable = SERIALIZATION_ERROR_CODES.has(pgCode ?? '');

        if (isRetryable && attempt < maxRetries) {
          attempt++;
          this.logger.warn(
            `Transaction failed with code ${pgCode}, retrying (${attempt}/${maxRetries})`,
            this.context,
          );
          continue;
        }

        throw this.wrapError(error);
      }
    }
  }

  private async runNew<T>(
    callback: () => Promise<T>,
    isolationLevel: IsolationLevel,
    timeoutMs?: number,
  ): Promise<T> {
    const pgIsolation = this.toPgIsolation(isolationLevel);

    const trxPromise = this.pool.db
      .transaction()
      .setIsolationLevel(pgIsolation)
      .execute(async (trx) => TransactionContext.run(trx, callback));

    if (!timeoutMs) return trxPromise;

    return Promise.race([
      trxPromise,
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new DatabaseError(`Transaction timed out after ${timeoutMs}ms`)),
          timeoutMs,
        ),
      ),
    ]);
  }

  private async runSavepoint<T>(callback: () => Promise<T>): Promise<T> {
    const trx = TransactionContext.getCurrent()!;
    const savepointName = `sp_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    await trx.executeQuery(CompiledQuery.raw(`SAVEPOINT ${savepointName}`));

    try {
      const result = await callback();
      await trx.executeQuery(CompiledQuery.raw(`RELEASE SAVEPOINT ${savepointName}`));
      return result;
    } catch (error) {
      await trx.executeQuery(CompiledQuery.raw(`ROLLBACK TO SAVEPOINT ${savepointName}`));
      throw error;
    }
  }

  private toPgIsolation(
    level: IsolationLevel,
  ): 'read uncommitted' | 'read committed' | 'repeatable read' | 'serializable' {
    switch (level) {
      case 'READ_UNCOMMITTED':
        return 'read uncommitted';
      case 'READ_COMMITTED':
        return 'read committed';
      case 'REPEATABLE_READ':
        return 'repeatable read';
      case 'SERIALIZABLE':
        return 'serializable';
    }
  }

  private wrapError(error: unknown): DatabaseError {
    if (error instanceof DatabaseError) return error;
    const cause = error instanceof Error ? error : undefined;
    const message = cause?.message ?? 'Transaction failed';
    return new DatabaseError(message, undefined, cause);
  }
}
