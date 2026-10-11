import { AsyncLocalStorage } from 'async_hooks';
import { Transaction } from 'kysely';
import { Database } from '../types/database.types';

/**
 * TransactionContext propagates the active Kysely transaction across async
 * call chains without passing it explicitly through every method signature.
 *
 * Repositories call getCurrent() to determine whether to use the transaction
 * or fall back to the shared pool connection:
 *
 *   protected get db(): Kysely<Database> | Transaction<Database> {
 *     return TransactionContext.getCurrent() ?? this.pool.db;
 *   }
 *
 * This is set by TransactionManager.run() before entering the callback.
 * It is cleared automatically when the callback resolves or rejects.
 */
export class TransactionContext {
  static readonly storage = new AsyncLocalStorage<Transaction<Database>>();

  static getCurrent(): Transaction<Database> | undefined {
    return this.storage.getStore();
  }

  static isActive(): boolean {
    return this.storage.getStore() !== undefined;
  }

  static run<T>(trx: Transaction<Database>, callback: () => Promise<T>): Promise<T> {
    return this.storage.run(trx, callback);
  }
}
