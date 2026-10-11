/**
 * ILogger is the platform-wide logging interface.
 *
 * All application services, domain services, and infrastructure adapters
 * inject ILogger rather than the concrete AppLoggerService. This allows:
 *  - Test doubles that record calls without spinning up Winston
 *  - Future logger backends without changing calling code
 *
 * The metadata parameter accepts structured key-value context that is
 * merged into the log entry. Use it for request-specific data (symbol,
 * orderId, strategy name) that would otherwise require string interpolation.
 *
 * Level semantics:
 *  debug    — low-level diagnostic data. Never enabled in production by default.
 *  info     — normal significant events (order placed, connection established).
 *  warn     — unexpected but recoverable situations.
 *  error    — failures that require attention but the system is still running.
 *  critical — failures that compromise system integrity (data corruption, OOM).
 */
export interface ILogger {
  debug(message: string, context?: string, metadata?: Record<string, unknown>): void;
  info(message: string, context?: string, metadata?: Record<string, unknown>): void;
  warn(message: string, context?: string, metadata?: Record<string, unknown>): void;
  error(
    message: string,
    trace?: string,
    context?: string,
    metadata?: Record<string, unknown>,
  ): void;
  critical(
    message: string,
    trace?: string,
    context?: string,
    metadata?: Record<string, unknown>,
  ): void;
}

export const LOGGER_TOKEN = Symbol('ILogger');
