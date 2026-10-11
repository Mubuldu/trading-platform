import { Injectable, Inject } from '@nestjs/common';
import * as https from 'node:https';
import { ILogger } from '@core/logging/logger.interface';
import { LOGGER_TOKEN } from '@core/logging/logger.interface';
import { Result, ok, err } from '@common/result';
import { CircuitBreaker } from '@common/resilience/circuit-breaker';
import { ExponentialBackoff } from '@common/resilience/backoff.strategy';
import { ExchangeId } from '@modules/exchange/enums/exchange.enums';
import {
  ExchangeError,
  ExchangeNetworkFailureError,
  ExchangeTimeoutError,
  ExchangeMaintenanceError,
} from '@modules/exchange/errors/exchange.error';
import { BinanceSpotConfig } from '../config/binance.config';
import { BINANCE_TOKENS } from '../config/binance.constants';
import { BinanceSignatureService } from '../auth/binance-signature.service';
import { BinanceServerTimeService } from '../server-time/binance-server-time.service';
import { BinanceRateLimitManager } from '../rate-limit/binance-rate-limit.manager';
import { BinanceErrorMapper } from '../mappers/binance-error.mapper';
import { BinanceResponseHeaders } from './binance-http.types';

const CONTEXT = 'BinanceRestClient';

export interface BinanceRequestOptions {
  readonly method: 'GET' | 'POST' | 'DELETE' | 'PUT';
  readonly endpoint: string;
  readonly params: Record<string, string | number | boolean>;
  readonly signed: boolean;
  readonly weight: number;
  readonly isOrderEndpoint?: boolean;
}

interface RawHttpResponse {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * BinanceRestClient is the HTTP transport layer for the Binance Spot adapter.
 *
 * Responsibilities:
 *  - Build and sign HTTP requests for the Binance REST API
 *  - Manage an HTTPS Agent for connection pooling and keep-alive
 *  - Enforce rate limits before sending requests
 *  - Parse and surface rate limit headers after receiving responses
 *  - Retry retryable failures with exponential backoff
 *  - Apply the circuit breaker to stop hammering a failing exchange
 *  - Translate HTTP and Binance error codes into normalized ExchangeErrors
 *
 * All parameters are sent as URL query string parameters (supported by Binance
 * for all methods including POST/PUT/DELETE). The request body is always empty.
 *
 * Security: API secrets are never logged, stored in fields after construction,
 * or included in error messages. The secret is fetched from the config object
 * on each call and used only within the scope of that call.
 */
@Injectable()
export class BinanceRestClient {
  private readonly agent: https.Agent;
  private readonly circuitBreaker: CircuitBreaker;
  private readonly backoff = new ExponentialBackoff({ baseMs: 200, maxMs: 10_000 });
  private readonly hostname: string;

  constructor(
    @Inject(BINANCE_TOKENS.CONFIG) private readonly config: BinanceSpotConfig,
    private readonly signatureService: BinanceSignatureService,
    private readonly serverTimeService: BinanceServerTimeService,
    private readonly rateLimitManager: BinanceRateLimitManager,
    private readonly errorMapper: BinanceErrorMapper,
    @Inject(LOGGER_TOKEN) private readonly logger: ILogger,
  ) {
    this.agent = new https.Agent({
      keepAlive: true,
      maxSockets: config.connectionPoolSize,
      maxFreeSockets: Math.max(2, Math.floor(config.connectionPoolSize / 2)),
      scheduling: 'lifo',
    });

    const url = new URL(config.baseUrl);
    this.hostname = url.hostname;

    this.circuitBreaker = new CircuitBreaker({
      name: 'binance-spot-rest',
      failureThreshold: 5,
      successThreshold: 2,
      timeoutMs: 60_000,
      isFailure: (e: unknown): boolean =>
        e instanceof ExchangeNetworkFailureError ||
        e instanceof ExchangeTimeoutError ||
        e instanceof ExchangeMaintenanceError,
      onStateChange: (from, to): void =>
        this.logger.warn(`BinanceRestClient circuit breaker: ${from} → ${to}`, CONTEXT),
    });
  }

  /**
   * Executes a Binance API request with pre-request rate limit check,
   * automatic signing, retry logic, and circuit breaking.
   */
  async execute<T>(options: BinanceRequestOptions): Promise<Result<T, ExchangeError>> {
    // Pre-flight rate limit check
    const weightCheck = this.rateLimitManager.checkRequestWeight(options.weight);
    if (weightCheck.isErr()) return err(weightCheck.error);

    if (options.isOrderEndpoint) {
      const orderCheck = this.rateLimitManager.checkOrderRate();
      if (orderCheck.isErr()) return err(orderCheck.error);
    }

    const maxAttempts = options.method === 'GET' ? this.config.maxRetries + 1 : 1;
    let lastError: ExchangeError | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const startMs = Date.now();
      try {
        const data = await this.circuitBreaker.execute(() => this.rawRequest<T>(options));
        const durationMs = Date.now() - startMs;
        this.logger.debug(
          `${options.method} ${options.endpoint} → 200 (${durationMs}ms, weight=${options.weight})`,
          CONTEXT,
        );
        return ok(data);
      } catch (e) {
        const durationMs = Date.now() - startMs;
        const error = this.coerceToExchangeError(e);

        this.logger.warn(
          `${options.method} ${options.endpoint} failed attempt ${attempt}/${maxAttempts}: ${error.message} (${durationMs}ms)`,
          CONTEXT,
        );

        if (!error.isRetryable || attempt === maxAttempts) {
          return err(error);
        }

        const delayMs = this.backoff.getDelayMs(attempt);
        await sleep(delayMs);
        lastError = error;
      }
    }

    return err(lastError ?? new ExchangeNetworkFailureError(ExchangeId.BINANCE_SPOT));
  }

  /** Destroys the connection pool. Call during adapter shutdown. */
  destroy(): void {
    this.agent.destroy();
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private async rawRequest<T>(options: BinanceRequestOptions): Promise<T> {
    const queryString = options.signed
      ? this.signatureService.buildSignedQueryString(
          options.params,
          this.serverTimeService.getTimestamp(),
          this.config.recvWindowMs,
          this.config.secretKey,
        )
      : this.signatureService.buildQueryString(options.params);

    const path = queryString ? `${options.endpoint}?${queryString}` : options.endpoint;

    const reqOptions: https.RequestOptions = {
      hostname: this.hostname,
      path,
      method: options.method,
      headers: {
        'X-MBX-APIKEY': this.config.apiKey,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'trading-platform/1.0',
      },
      agent: this.agent,
    };

    const response = await this.makeHttpRequest(reqOptions);

    const parsedHeaders = this.parseRateLimitHeaders(response.headers);
    this.rateLimitManager.updateFromHeaders(parsedHeaders);

    if (response.statusCode === 200) {
      return JSON.parse(response.body) as T;
    }

    throw this.errorMapper.fromHttpResponse(response.statusCode, response.body, parsedHeaders);
  }

  private makeHttpRequest(options: https.RequestOptions): Promise<RawHttpResponse> {
    return new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        const chunks: Uint8Array[] = [];
        res.on('data', (chunk: Uint8Array) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers as Record<string, string | string[] | undefined>,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
        res.on('error', (e: Error) =>
          reject(new ExchangeNetworkFailureError(ExchangeId.BINANCE_SPOT, e, e.message)),
        );
      });

      req.on('error', (e: Error) =>
        reject(new ExchangeNetworkFailureError(ExchangeId.BINANCE_SPOT, e, e.message)),
      );

      req.setTimeout(this.config.timeoutMs, () => {
        req.destroy();
        reject(
          new ExchangeTimeoutError(
            ExchangeId.BINANCE_SPOT,
            options.path ?? 'unknown',
            this.config.timeoutMs,
          ),
        );
      });

      req.end();
    });
  }

  private parseRateLimitHeaders(
    headers: Record<string, string | string[] | undefined>,
  ): BinanceResponseHeaders {
    const toNumber = (v: string | string[] | undefined): number | undefined => {
      const s = Array.isArray(v) ? v[0] : v;
      if (!s) return undefined;
      const n = parseInt(s, 10);
      return isNaN(n) ? undefined : n;
    };

    return {
      usedWeight1m: toNumber(headers['x-mbx-used-weight-1m']),
      orderCount10s: toNumber(headers['x-mbx-order-count-10s']),
      orderCountDay: toNumber(headers['x-mbx-order-count-1d']),
      retryAfterSec: toNumber(headers['retry-after']),
    };
  }

  private coerceToExchangeError(e: unknown): ExchangeError {
    if (e instanceof ExchangeError) return e;
    if (e instanceof Error) {
      return new ExchangeNetworkFailureError(ExchangeId.BINANCE_SPOT, e, e.message);
    }
    return new ExchangeNetworkFailureError(ExchangeId.BINANCE_SPOT);
  }
}
