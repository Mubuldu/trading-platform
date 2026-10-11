import { Injectable, LoggerService, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as winston from 'winston';
import 'winston-daily-rotate-file';
import { getCorrelationId, getRequestId } from './correlation-id.store';
import { AppConfig } from '@config/app.config';
import { LoggingConfig } from '@config/logging.config';
import { ILogger } from './logger.interface';

/**
 * AppLoggerService is the single logging implementation for the entire platform.
 *
 * Every log line carries full context for log correlation:
 *  - correlationId: distributed trace ID (propagated across services)
 *  - requestId: per-request ID local to this service
 *  - service: application name (from AppConfig)
 *  - context: NestJS module or class name (caller-supplied)
 *  - timestamp: ISO 8601 with milliseconds and timezone
 *
 * Both IDs are read from AsyncLocalStorage at log time, not at construction,
 * so they are always scoped to the current request context.
 */
@Injectable()
export class AppLoggerService implements LoggerService, ILogger, OnModuleDestroy {
  private readonly logger: winston.Logger;

  constructor(private readonly configService: ConfigService) {
    const app = this.configService.get<AppConfig>('app');
    const logging = this.configService.get<LoggingConfig>('logging');
    if (!app || !logging) {
      throw new Error(
        'AppConfig or LoggingConfig is not available — ConfigModule must be imported first',
      );
    }
    this.logger = this.createLogger(app, logging);
  }

  private createLogger(app: AppConfig, logging: LoggingConfig): winston.Logger {
    const { combine, timestamp, json, colorize, printf, errors, label } = winston.format;
    const isDev = app.environment === 'development';
    const isTest = app.environment === 'test';

    const requestContextFormat = winston.format((info) => {
      info['correlationId'] = getCorrelationId();
      info['requestId'] = getRequestId();
      return info;
    })();

    const baseFormat = combine(
      errors({ stack: true }),
      label({ label: app.name }),
      timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
      requestContextFormat,
    );

    const prettyFormat = combine(
      baseFormat,
      colorize({ all: true }),
      printf((info) => {
        const {
          timestamp,
          level,
          label: svc,
          correlationId,
          requestId,
          context,
          message,
          stack,
        } = info;
        const ctx = context ? ` [${context}]` : '';
        const cid = correlationId !== 'no-context' ? ` {cid:${correlationId as string}}` : '';
        const rid = requestId !== 'no-context' ? ` {rid:${requestId as string}}` : '';
        const trace = stack ? `\n${stack}` : '';
        return `${timestamp} ${level} [${svc}]${ctx}${cid}${rid} ${message}${trace}`;
      }),
    );

    const jsonFormat = combine(baseFormat, json());

    const transports: winston.transport[] = [];

    if (logging.enableConsole) {
      transports.push(
        new winston.transports.Console({
          silent: isTest,
          format: isDev && !logging.jsonOutput ? prettyFormat : jsonFormat,
        }),
      );
    }

    if (!isDev && !isTest) {
      transports.push(
        new winston.transports.DailyRotateFile({
          dirname: logging.dir,
          filename: 'app-%DATE%.log',
          datePattern: 'YYYY-MM-DD',
          zippedArchive: true,
          maxSize: `${logging.maxFileSizeMb}m`,
          maxFiles: logging.maxFiles,
          format: jsonFormat,
          level: logging.level,
        }),
        new winston.transports.DailyRotateFile({
          dirname: logging.dir,
          filename: 'error-%DATE%.log',
          datePattern: 'YYYY-MM-DD',
          zippedArchive: true,
          maxSize: '20m',
          maxFiles: logging.errorMaxFiles,
          format: jsonFormat,
          level: 'error',
        }),
      );
    }

    return winston.createLogger({
      level: logging.level,
      defaultMeta: { service: app.name },
      transports,
      exitOnError: false,
    });
  }

  // ── NestJS LoggerService interface ────────────────────────────────────────

  log(message: string, context?: string): void {
    this.logger.info(message, { context });
  }

  error(
    message: string,
    trace?: string,
    context?: string,
    metadata?: Record<string, unknown>,
  ): void {
    this.logger.error(message, { context, stack: trace, ...metadata });
  }

  warn(message: string, context?: string, metadata?: Record<string, unknown>): void {
    this.logger.warn(message, { context, ...metadata });
  }

  debug(message: string, context?: string, metadata?: Record<string, unknown>): void {
    this.logger.debug(message, { context, ...metadata });
  }

  verbose(message: string, context?: string): void {
    this.logger.verbose(message, { context });
  }

  fatal(message: string, trace?: string, context?: string): void {
    this.logger.error(message, { context, stack: trace, level: 'critical' });
  }

  // ── ILogger interface ─────────────────────────────────────────────────────

  info(message: string, context?: string, metadata?: Record<string, unknown>): void {
    this.logger.info(message, { context, ...metadata });
  }

  critical(
    message: string,
    trace?: string,
    context?: string,
    metadata?: Record<string, unknown>,
  ): void {
    this.logger.error(message, { context, stack: trace, critical: true, ...metadata });
  }

  onModuleDestroy(): void {
    this.logger.close();
  }
}
