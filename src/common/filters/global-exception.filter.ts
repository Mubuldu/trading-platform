import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { getCorrelationId } from '@core/logging/correlation-id.store';
import { BaseError } from '@common/errors/base.error';
import { ErrorCode } from '@common/errors/error-codes.enum';

export interface ErrorResponse {
  statusCode: number;
  error: string;
  errorCode: ErrorCode | string;
  message: string | string[];
  correlationId: string;
  timestamp: string;
  path: string;
}

/**
 * GlobalExceptionFilter is the last line of defense for all uncaught errors.
 *
 * Error resolution priority:
 *  1. BaseError subclasses — use the error's own httpStatus and code
 *  2. HttpException (NestJS/framework) — use its status and message
 *  3. Unknown errors — return 500 with a generic message (never expose internals)
 *
 * The BaseError hierarchy takes priority over HttpException because domain and
 * infrastructure errors carry more semantic information (isRetryable, code,
 * details). Framework HttpExceptions are for validation and routing, not
 * business failures.
 *
 * Security: details from BaseError are never sent to the client. Only
 * the public message, code, and httpStatus are exposed. Internal stack
 * traces and error chains are logged server-side only.
 */
@Injectable()
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly context = GlobalExceptionFilter.name;

  constructor(private readonly logger: AppLoggerService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const resolved = this.resolveException(exception);
    const correlationId = getCorrelationId();

    this.logException(exception, resolved.statusCode, request);

    const body: ErrorResponse = {
      statusCode: resolved.statusCode,
      error: HttpStatus[resolved.statusCode] ?? 'UNKNOWN_ERROR',
      errorCode: resolved.errorCode,
      message: resolved.message,
      correlationId,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    response.status(resolved.statusCode).json(body);
  }

  private resolveException(exception: unknown): {
    statusCode: number;
    errorCode: ErrorCode | string;
    message: string | string[];
  } {
    if (exception instanceof BaseError) {
      return {
        statusCode: exception.httpStatus,
        errorCode: exception.code,
        message: exception.message,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      const message =
        typeof exceptionResponse === 'string'
          ? exceptionResponse
          : ((exceptionResponse as { message: string | string[] }).message ?? exception.message);

      return { statusCode: status, errorCode: 'HTTP_EXCEPTION', message };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      errorCode: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred. Please try again later.',
    };
  }

  private logException(exception: unknown, statusCode: number, request: Request): void {
    const method = request.method;
    const url = request.url;
    const label = `[${method}] ${url} → ${statusCode}`;

    if (statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      const stack = exception instanceof Error ? exception.stack : undefined;
      const message = exception instanceof Error ? exception.message : String(exception);
      this.logger.error(`${label} — ${message}`, stack, this.context);
      return;
    }

    if (statusCode >= HttpStatus.BAD_REQUEST) {
      const message = exception instanceof Error ? exception.message : String(exception);
      this.logger.warn(`${label} — ${message}`, this.context);
    }
  }
}
