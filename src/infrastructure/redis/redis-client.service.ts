import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis, { RedisOptions } from 'ioredis';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { RedisConfig } from './config/redis.config';

@Injectable()
export class RedisClientService implements OnModuleDestroy {
  private readonly context = RedisClientService.name;
  private readonly client: Redis;
  private readonly subscriberClient: Redis;
  /** Dedicated connections created for blocking consumers (one per subscriber). */
  private readonly blockingClients: Redis[] = [];

  /**
   * Per-client ready state. Using separate flags prevents a race condition
   * where one client's disconnect event would corrupt the other client's state:
   *   - subscriber 'close' must not report primary as disconnected
   *   - primary 'ready' must not report the service as fully connected
   *     when the subscriber is still reconnecting
   *
   * isConnected() returns true only when BOTH clients are ready.
   */
  private readonly clientState = { primary: false, subscriber: false };

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: AppLoggerService,
  ) {
    const config = this.configService.get<RedisConfig>('redis')!;
    const options = this.buildOptions(config);
    this.client = new Redis(options);
    this.subscriberClient = new Redis(options);

    this.wireEvents(this.client, 'primary');
    this.wireEvents(this.subscriberClient, 'subscriber');
  }

  private buildOptions(config: RedisConfig): RedisOptions {
    const url = new URL(config.url);
    return {
      host: url.hostname,
      port: parseInt(url.port || '6379', 10),
      password: config.password || undefined,
      keyPrefix: config.keyPrefix,
      lazyConnect: true,
      enableOfflineQueue: true,
      maxRetriesPerRequest: null,
      // Abort the initial TCP handshake if it takes more than 5 s.
      // NOTE: commandTimeout is intentionally absent — ioredis applies it to
      // every command on the client, including XREADGROUP BLOCK and SUBSCRIBE,
      // which are long-lived blocking calls by design. Instead, the health
      // provider wraps individual INFO calls in a Promise.race timeout so only
      // those stall-prone commands get a deadline.
      connectTimeout: 5_000,
      retryStrategy: (times: number): number | null => {
        if (config.reconnect.maxRetries >= 0 && times > config.reconnect.maxRetries) {
          this.logger.error(
            `Redis reconnect exhausted after ${times} attempts`,
            undefined,
            this.context,
          );
          return null;
        }
        const delay = Math.min(
          config.reconnect.retryDelayMs * Math.pow(2, times - 1),
          config.reconnect.maxRetryDelayMs,
        );
        this.logger.warn(`Redis reconnecting in ${delay}ms (attempt ${times})`, this.context);
        return delay;
      },
      reconnectOnError: (err: Error): boolean => {
        const targetErrors = ['READONLY', 'ECONNRESET', 'ECONNREFUSED'];
        return targetErrors.some((e) => err.message.includes(e));
      },
    };
  }

  private wireEvents(client: Redis, label: 'primary' | 'subscriber'): void {
    client.on('connect', () => {
      this.logger.log(`Redis [${label}] connection established`, this.context);
    });
    client.on('ready', () => {
      this.clientState[label] = true;
      this.logger.log(`Redis [${label}] ready`, this.context);
    });
    client.on('error', (err: Error) => {
      this.logger.error(`Redis [${label}] error: ${err.message}`, err.stack, this.context);
    });
    client.on('close', () => {
      this.clientState[label] = false;
      this.logger.warn(`Redis [${label}] connection closed`, this.context);
    });
    client.on('reconnecting', () => {
      this.logger.warn(`Redis [${label}] reconnecting`, this.context);
    });
    client.on('end', () => {
      this.clientState[label] = false;
      this.logger.warn(`Redis [${label}] connection ended`, this.context);
    });
  }

  async connect(): Promise<void> {
    // Individual 'ready' events on each client will set clientState[label] = true.
    // We do not set the flags here to avoid a window where isConnected() returns
    // true before both clients have actually fired their 'ready' events.
    await Promise.all([this.client.connect(), this.subscriberClient.connect()]);
    this.logger.log('Redis clients connected', this.context);
  }

  async disconnect(): Promise<void> {
    this.clientState.primary = false;
    this.clientState.subscriber = false;
    await Promise.all([this.client.quit(), this.subscriberClient.quit()]);
    this.logger.log('Redis clients disconnected', this.context);
  }

  async onModuleDestroy(): Promise<void> {
    // Quit all dedicated blocking clients first.
    if (this.blockingClients.length > 0) {
      await Promise.allSettled(this.blockingClients.map((c) => c.quit()));
      this.blockingClients.length = 0;
    }
    await this.disconnect();
  }

  getClient(): Redis {
    return this.client;
  }

  getSubscriberClient(): Redis {
    return this.subscriberClient;
  }

  /**
   * Create a dedicated ioredis connection for blocking commands (XREADGROUP BLOCK).
   * Each caller gets its own connection so concurrent blocking calls do not starve
   * each other on the shared primary client. The service owns the lifecycle — all
   * blocking clients are quit on module destroy.
   */
  createBlockingClient(): Redis {
    const config = this.configService.get<RedisConfig>('redis')!;
    const options = this.buildOptions(config);
    const client = new Redis(options);
    // Connect and track; errors/reconnects are handled by ioredis internals.
    void client.connect().catch((err: Error) => {
      this.logger.error(
        `Blocking Redis client connect error: ${err.message}`,
        err.stack,
        this.context,
      );
    });
    this.blockingClients.push(client);
    return client;
  }

  isConnected(): boolean {
    return this.clientState.primary && this.clientState.subscriber;
  }

  async ping(): Promise<number> {
    const start = Date.now();
    await this.client.ping();
    return Date.now() - start;
  }

  async getInfo(): Promise<string> {
    return this.client.info();
  }

  async getMemoryUsage(): Promise<Record<string, string>> {
    const info = await this.client.info('memory');
    const result: Record<string, string> = {};
    for (const line of info.split('\r\n')) {
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        result[line.slice(0, colonIdx).trim()] = line.slice(colonIdx + 1).trim();
      }
    }
    return result;
  }

  async getConnectedClients(): Promise<number> {
    const info = await this.client.info('clients');
    const match = info.match(/connected_clients:(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }

  async getReplicationInfo(): Promise<Record<string, string>> {
    const info = await this.client.info('replication');
    const result: Record<string, string> = {};
    for (const line of info.split('\r\n')) {
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        result[line.slice(0, colonIdx).trim()] = line.slice(colonIdx + 1).trim();
      }
    }
    return result;
  }
}
