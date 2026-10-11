import 'reflect-metadata';

export type IsolationLevel =
  'READ_UNCOMMITTED' | 'READ_COMMITTED' | 'REPEATABLE_READ' | 'SERIALIZABLE';

export type Propagation = 'REQUIRED' | 'REQUIRES_NEW' | 'SUPPORTS' | 'NOT_SUPPORTED';

export interface TransactionalOptions {
  isolationLevel?: IsolationLevel;
  propagation?: Propagation;
}

export const TRANSACTIONAL_METADATA_KEY = Symbol('transactional');

/**
 * @Transactional() marks a method as requiring a database transaction.
 *
 * This decorator is metadata-only in this milestone. It does not modify
 * the method's execution. A future TransactionInterceptor or database
 * adapter will read this metadata via Reflect.getMetadata and wrap the
 * method call in a transaction accordingly.
 *
 * Why metadata and not direct wrapping:
 *  - We have no database connection in this milestone
 *  - The transaction mechanism depends on the ORM (TypeORM, Drizzle, Prisma)
 *  - Metadata allows the wrapping strategy to be chosen at the infrastructure
 *    layer without touching the domain or application layer
 *
 * Usage:
 *   @Transactional({ isolationLevel: 'SERIALIZABLE' })
 *   async executeOrder(order: Order): Promise<Result<void>> { ... }
 */
export function Transactional(options: TransactionalOptions = {}): MethodDecorator {
  return (
    target: object,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor,
  ): PropertyDescriptor => {
    Reflect.defineMetadata(
      TRANSACTIONAL_METADATA_KEY,
      { isolationLevel: 'READ_COMMITTED', propagation: 'REQUIRED', ...options },
      target,
      propertyKey as string,
    );
    return descriptor;
  };
}

export function getTransactionalMetadata(
  target: object,
  propertyKey: string,
): TransactionalOptions | undefined {
  return Reflect.getMetadata(TRANSACTIONAL_METADATA_KEY, target, propertyKey) as
    TransactionalOptions | undefined;
}
