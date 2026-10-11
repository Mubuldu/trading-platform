import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { runWithContext } from '@core/logging/correlation-id.store';

export const CORRELATION_ID_HEADER = 'x-correlation-id';
export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * CorrelationIdMiddleware ensures every request carries two IDs through its
 * entire async lifecycle via AsyncLocalStorage.
 *
 * correlationId — distributed trace ID:
 *   Accepted from upstream when present in x-correlation-id header (allows
 *   distributed tracing across services that forward the header). Generated
 *   as UUIDv4 otherwise. Echoed back in the response header.
 *
 * requestId — local service ID:
 *   Always generated fresh (UUIDv4) regardless of incoming headers. Unique
 *   per HTTP request within this service. Used for per-request log correlation
 *   and deduplication. Echoed back in x-request-id response header.
 *
 * Security: incoming correlation IDs are validated for length to prevent
 * header injection abuse.
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incomingId = req.headers[CORRELATION_ID_HEADER];
    const correlationId = this.resolveCorrelationId(incomingId);
    const requestId = uuidv4();

    res.setHeader(CORRELATION_ID_HEADER, correlationId);
    res.setHeader(REQUEST_ID_HEADER, requestId);

    runWithContext({ correlationId, requestId }, () => next());
  }

  private resolveCorrelationId(incoming: string | string[] | undefined): string {
    if (typeof incoming === 'string' && incoming.length > 0 && incoming.length <= 128) {
      return incoming;
    }
    return uuidv4();
  }
}
