import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ILogger } from '@core/logging/logger.interface';
import {
  WsConnectionManager,
  WsReconnectManager,
  WsHeartbeatMonitor,
  WsSubscriptionManager,
  WsSequenceValidator,
  WsMetricsCollector,
  WsLatencyMonitor,
  WsConnectionState,
} from '@common/websocket';
import type {
  WsRawMessage,
  WsMessageHandler,
  WsMessageMeta,
  WsConnectionMetrics,
  WsLatencyMetrics,
} from '@common/websocket';
import { MarketDataEventBus } from '@modules/exchange/market-data-event-bus';
import { BinanceWsMessageNormalizer } from './binance-ws-message-normalizer';
import type { BinanceWsStreamEnvelope, BinanceWsCommandResponse } from './binance-ws.types';
import { BINANCE_WS_STREAM_PATH, BINANCE_WS_METHOD } from './binance-ws.constants';

const COMMAND_TIMEOUT_MS = 5_000;
const RESUBSCRIBE_BATCH_SIZE = 100;

/** Configuration consumed by BinanceWsStreamManager. */
export interface BinanceWsStreamConfig {
  readonly wsBaseUrl: string;
  readonly heartbeatIntervalMs: number;
  readonly heartbeatTimeoutMs: number;
  readonly missedHeartbeatsThreshold: number;
  readonly reconnectBaseDelayMs: number;
  readonly reconnectMaxDelayMs: number;
  readonly maxReconnectAttempts: number;
  readonly reconnectStableThresholdMs: number;
  readonly maxStreams: number;
  readonly maxMessageSizeBytes: number;
}

interface PendingCommand {
  readonly timer: ReturnType<typeof setTimeout>;
  readonly method: string;
}

/**
 * BinanceWsStreamManager orchestrates the full Binance combined-stream
 * WebSocket lifecycle for the spot exchange.
 *
 * Responsibilities:
 *  - Manages one WsConnectionManager pointed at /stream (combined stream).
 *  - Routes incoming { stream, data } envelopes to BinanceWsMessageNormalizer.
 *  - Validates sequence integrity on diff-depth streams; signals 'resync' on
 *    excessive gaps so consumers know to refetch a REST snapshot.
 *  - Publishes normalized payloads to MarketDataEventBus for broad consumers.
 *  - Dispatches to WsSubscriptionManager for per-stream callback consumers.
 *  - Tracks SUBSCRIBE/UNSUBSCRIBE command acknowledgements (5 s timeout).
 *  - Re-subscribes all active streams on every reconnect.
 *  - Collects WsConnectionMetrics and WsLatencyMetrics.
 *
 * All methods are non-throwing. Errors are logged and suppressed internally.
 */
@Injectable()
export class BinanceWsStreamManager implements OnModuleDestroy {
  private readonly connectionManager: WsConnectionManager;
  private readonly subscriptionManager: WsSubscriptionManager;
  private readonly sequenceValidator: WsSequenceValidator;
  private readonly metricsCollector: WsMetricsCollector;
  private readonly latencyMonitor: WsLatencyMonitor;

  private nextRequestId = 1;
  private readonly pendingCommands = new Map<number, PendingCommand>();

  constructor(
    config: BinanceWsStreamConfig,
    private readonly normalizer: BinanceWsMessageNormalizer,
    private readonly eventBus: MarketDataEventBus,
    private readonly logger: ILogger,
  ) {
    const reconnectManager = new WsReconnectManager({
      baseDelayMs: config.reconnectBaseDelayMs,
      maxDelayMs: config.reconnectMaxDelayMs,
      maxAttempts: config.maxReconnectAttempts,
      stableThresholdMs: config.reconnectStableThresholdMs,
    });

    const heartbeatMonitor = new WsHeartbeatMonitor({
      intervalMs: config.heartbeatIntervalMs,
      timeoutMs: config.heartbeatTimeoutMs,
      threshold: config.missedHeartbeatsThreshold,
    });

    this.connectionManager = new WsConnectionManager(
      {
        url: `${config.wsBaseUrl}${BINANCE_WS_STREAM_PATH}`,
        heartbeatIntervalMs: config.heartbeatIntervalMs,
        heartbeatTimeoutMs: config.heartbeatTimeoutMs,
        missedHeartbeatsThreshold: config.missedHeartbeatsThreshold,
        reconnectBaseDelayMs: config.reconnectBaseDelayMs,
        reconnectMaxDelayMs: config.reconnectMaxDelayMs,
        maxReconnectAttempts: config.maxReconnectAttempts,
        stableConnectionThresholdMs: config.reconnectStableThresholdMs,
        maxMessageSizeBytes: config.maxMessageSizeBytes,
      },
      reconnectManager,
      heartbeatMonitor,
      logger,
    );

    this.subscriptionManager = new WsSubscriptionManager(config.maxStreams);
    this.sequenceValidator = new WsSequenceValidator();
    this.metricsCollector = new WsMetricsCollector();
    this.latencyMonitor = new WsLatencyMonitor();

    this.wireConnectionEvents();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Open the WebSocket connection. No-op if already connected or connecting. */
  connect(): void {
    this.connectionManager.connect();
  }

  /**
   * Subscribe a callback handler to a stream.
   *
   * The handler is registered immediately. If this is the first subscriber for
   * this stream and the connection is active, a SUBSCRIBE command is sent to
   * Binance. If not yet connected, the stream will be subscribed on the next
   * 'connected' event via resubscribeAll().
   *
   * @returns The subscriptionId, or null if the maxStreams limit is reached.
   */
  subscribe(streamId: string, handler: WsMessageHandler): string | null {
    const result = this.subscriptionManager.subscribe(streamId, handler);
    if (!result) return null;

    if (result.isNewStream && this.connectionManager.isConnected) {
      this.sendCommand(BINANCE_WS_METHOD.SUBSCRIBE, [streamId]);
    }

    return result.subscriptionId;
  }

  /**
   * Remove a handler from a stream.
   *
   * When the last handler is removed, an UNSUBSCRIBE command is sent to stop
   * receiving data for that stream.
   */
  unsubscribe(streamId: string, handler: WsMessageHandler): void {
    const result = this.subscriptionManager.unsubscribe(streamId, handler);

    if (result.streamRemoved && this.connectionManager.isConnected) {
      this.sendCommand(BINANCE_WS_METHOD.UNSUBSCRIBE, [streamId]);
    }
  }

  /**
   * Remove all subscriptions and send UNSUBSCRIBE for every active stream.
   * The sequence validator is reset. Pending commands are cancelled.
   */
  unsubscribeAll(): void {
    const streamIds = [...this.subscriptionManager.getStreamIds()];
    this.subscriptionManager.destroy();
    this.sequenceValidator.resetAll();

    if (streamIds.length > 0 && this.connectionManager.isConnected) {
      for (let i = 0; i < streamIds.length; i += RESUBSCRIBE_BATCH_SIZE) {
        this.sendCommand(
          BINANCE_WS_METHOD.UNSUBSCRIBE,
          streamIds.slice(i, i + RESUBSCRIBE_BATCH_SIZE),
        );
      }
    }
  }

  /**
   * Gracefully close the WebSocket connection without destroying subscriptions.
   * Active streams will be automatically resubscribed when connect() is called again.
   */
  disconnect(): void {
    this.cancelAllPendingCommands();
    this.connectionManager.disconnect();
  }

  /**
   * Permanently stop this manager. Cleans up all resources.
   * A new instance must be created to reconnect.
   */
  stop(): void {
    this.cancelAllPendingCommands();
    this.subscriptionManager.destroy();
    this.sequenceValidator.resetAll();
    this.connectionManager.stop();
  }

  onModuleDestroy(): void {
    this.stop();
  }

  /** Snapshot of connection counters, rates, and latency percentiles. */
  getMetrics(): { readonly connection: WsConnectionMetrics; readonly latency: WsLatencyMetrics } {
    return {
      connection: this.metricsCollector.getMetrics(this.subscriptionManager.streamCount),
      latency: this.latencyMonitor.getMetrics(),
    };
  }

  get state(): WsConnectionState {
    return this.connectionManager.state;
  }

  // ── Event wiring ───────────────────────────────────────────────────────────

  private wireConnectionEvents(): void {
    this.connectionManager.on(
      'stateChange',
      (_prev: WsConnectionState, next: WsConnectionState) => {
        this.metricsCollector.onStateChange(next);
      },
    );

    this.connectionManager.on('connected', () => {
      this.sequenceValidator.resetAll();
      this.latencyMonitor.reset();
      this.resubscribeAll();
      this.logger.info('Binance WS connected', 'BinanceWsStreamManager');
    });

    this.connectionManager.on('reconnecting', (attempt: number, delayMs: number) => {
      this.metricsCollector.recordReconnect();
      this.cancelAllPendingCommands();
      this.logger.warn(
        `Binance WS reconnecting (attempt ${attempt}, delay ${delayMs} ms)`,
        'BinanceWsStreamManager',
      );
    });

    this.connectionManager.on('failed', (reason: string) => {
      this.cancelAllPendingCommands();
      this.logger.error(
        `Binance WS permanently failed: ${reason}`,
        undefined,
        'BinanceWsStreamManager',
      );
    });

    this.connectionManager.on('error', (error: Error) => {
      this.metricsCollector.recordError();
      this.logger.error(
        `Binance WS socket error: ${error.message}`,
        undefined,
        'BinanceWsStreamManager',
      );
    });

    this.connectionManager.on('message', (raw: WsRawMessage) => {
      this.handleRawMessage(raw);
    });
  }

  // ── Message pipeline ───────────────────────────────────────────────────────

  private handleRawMessage(raw: WsRawMessage): void {
    const handlerEnteredAt = Date.now();
    this.metricsCollector.recordMessage(raw.byteLength);

    // Record JS event-loop overhead between socket receive and this handler
    this.latencyMonitor.recordNetworkLatency(handlerEnteredAt - raw.receivedAt);

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.data);
    } catch {
      this.logger.debug('Binance WS: failed to parse JSON', 'BinanceWsStreamManager');
      return;
    }

    // Command acknowledgement: { id, result, error? }
    if (this.isCommandResponse(parsed)) {
      this.resolveCommand(parsed as BinanceWsCommandResponse);
      return;
    }

    // Stream envelope: { stream, data }
    if (!this.isStreamEnvelope(parsed)) return;

    const envelope = parsed as BinanceWsStreamEnvelope;
    const normalized = this.normalizer.normalize(
      envelope.stream,
      envelope.data,
      new Date(raw.receivedAt),
    );
    if (!normalized) return;

    // Sequence validation — only for diff-depth streams (have both updateId + firstUpdateId)
    if (normalized.updateId !== undefined && normalized.firstUpdateId !== undefined) {
      const seqResult = this.sequenceValidator.validate(
        envelope.stream,
        normalized.updateId,
        normalized.firstUpdateId,
      );

      if (seqResult === 'duplicate') return;

      if (seqResult === 'resync') {
        this.logger.warn(
          'Order book sequence integrity lost — consumer must refetch REST snapshot',
          'BinanceWsStreamManager',
          { stream: envelope.stream },
        );
        // Continue publishing: the consumer detects the gap via the normalized
        // updateId and decides whether to refetch. Sequence state is cleared;
        // the next message will be treated as 'initialized'.
      }
    }

    // Message delay: exchange event time → local receive time
    this.latencyMonitor.recordMessageDelay(normalized.exchangeTimestampMs, raw.receivedAt);

    // Publish to event bus — broad consumers subscribe via eventType string
    this.eventBus.emit(normalized.eventType, normalized.payload);

    // Dispatch to per-stream callbacks
    const meta: WsMessageMeta = {
      streamId: envelope.stream,
      receivedAt: new Date(raw.receivedAt),
      processingLatencyMs: Date.now() - raw.receivedAt,
      sequenceId: normalized.updateId,
    };
    this.subscriptionManager.dispatch(envelope.stream, normalized.payload, meta);

    // Full pipeline latency: socket receive → dispatch complete
    this.latencyMonitor.recordProcessingLatency(Date.now() - raw.receivedAt);
  }

  private isCommandResponse(parsed: unknown): boolean {
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return false;
    const obj = parsed as Record<string, unknown>;
    return typeof obj['id'] === 'number' && 'result' in obj;
  }

  private isStreamEnvelope(parsed: unknown): boolean {
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return false;
    const obj = parsed as Record<string, unknown>;
    return typeof obj['stream'] === 'string' && 'data' in obj;
  }

  // ── Command handling ───────────────────────────────────────────────────────

  private resolveCommand(response: BinanceWsCommandResponse): void {
    const pending = this.pendingCommands.get(response.id);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pendingCommands.delete(response.id);

    if (response.error) {
      this.logger.warn(
        `Binance WS ${pending.method} command failed: [${response.error.code}] ${response.error.msg}`,
        'BinanceWsStreamManager',
      );
    }
  }

  private sendCommand(method: string, params: readonly string[]): void {
    const id = this.nextRequestId++;
    const payload = JSON.stringify({ method, params, id });

    const sent = this.connectionManager.send(payload);
    if (!sent) {
      this.logger.debug(
        `Binance WS ${method} not sent — connection not ready`,
        'BinanceWsStreamManager',
      );
      return;
    }

    const timer = setTimeout(() => {
      if (this.pendingCommands.delete(id)) {
        this.logger.warn(
          `Binance WS ${method} command ${id} timed out after ${COMMAND_TIMEOUT_MS} ms`,
          'BinanceWsStreamManager',
        );
      }
    }, COMMAND_TIMEOUT_MS);

    this.pendingCommands.set(id, { timer, method });
  }

  private resubscribeAll(): void {
    const streams = this.subscriptionManager.getStreamIds();
    if (streams.length === 0) return;

    this.logger.info(
      `Binance WS resubscribing ${streams.length} stream(s)`,
      'BinanceWsStreamManager',
    );

    for (let i = 0; i < streams.length; i += RESUBSCRIBE_BATCH_SIZE) {
      this.sendCommand(BINANCE_WS_METHOD.SUBSCRIBE, streams.slice(i, i + RESUBSCRIBE_BATCH_SIZE));
    }
  }

  private cancelAllPendingCommands(): void {
    for (const [id, pending] of this.pendingCommands) {
      clearTimeout(pending.timer);
      this.pendingCommands.delete(id);
      this.logger.debug(
        `Binance WS ${pending.method} command ${id} cancelled (connection lost)`,
        'BinanceWsStreamManager',
      );
    }
  }
}
