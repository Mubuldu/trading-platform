import { Result } from '@common/result';
import { DatabaseError } from '@common/errors/infrastructure.error';
import { NotFoundError } from '@domain/errors/domain.error';
import { AggregateRoot } from './aggregate-root';

/**
 * Repository<T, TId> is the port through which the domain accesses persistence.
 *
 * The domain depends on this interface; infrastructure implements it.
 * This inverts the dependency: the domain does not know about databases,
 * ORMs, or query languages. Infrastructure adapts to the domain, not vice versa.
 *
 * Return types use Result<T, E> so that callers must handle both success and
 * failure explicitly. Never throw from a Repository implementation — return
 * a DatabaseError wrapped in Err instead.
 *
 * Extend this interface per aggregate with aggregate-specific query methods:
 *   interface OrderRepository extends Repository<Order, OrderId> {
 *     findBySymbol(symbol: Symbol): Promise<Result<Order[]>>;
 *   }
 */
export interface Repository<T extends AggregateRoot<TId>, TId> {
  findById(id: TId): Promise<Result<T, NotFoundError | DatabaseError>>;
  save(aggregate: T): Promise<Result<void, DatabaseError>>;
  delete(id: TId): Promise<Result<void, DatabaseError>>;
}
