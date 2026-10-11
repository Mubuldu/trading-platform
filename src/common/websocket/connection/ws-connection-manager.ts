import { EventEmitter } from 'events';
import { ILogger } from '@core/logging/logger.interface';
import { WsConnectionState } from '../enums/ws-connection-state.enum';
import { WsClientConfig } from '../types/ws-config.types';
import { WsRawMessage } from '../types/ws-message.types';
import { WsRawClient } from '../client/ws-raw-client';
import { WsReconnectManager } from '../reconnect/ws-reconnect-manager';
import { WsHeartbeatMonitor } from '../heartbeat/ws-heartbeat-monitor';

/**
 * WsConnectionManager is the central state machine for a single WebSocket
 * connection. It coordinates WsRawClient, WsReconnectManager, and
 * WsHeartbeatMonitor.
 *
 * State machine:
 *   DISCONNECTED ──connect()──► CONNECTING ──open──► CONNECTED
 *   CONNECTED ──close/error──► RECONNECTING ──timer──► CONNECTING
 *   RECONNECTING ──maxAttempts──► FAILED
 *   Any ──stop()──► STOPPED (terminal)
 *
 * Emitted events:
 *   stateChange(prev, next)     — every state transition
 *   connected()                 — entered CONNECTED state
 *   disconnected(code, reason)  — socket closed (precedes reconnect or FAILED)
 *   reconnecting(attempt, delayMs)
 *   failed(reason)              — transitioned to FAILED state
 *   message(WsRawMessage)       — incoming text message
 *   error(Error)                — non-fatal socket error
 *   heartbeatTimeout()          — missed heartbeats triggered reconnect
 */
export class WsConnectionManager extends EventEmitter {
  private _state: WsConnectionState = WsConnectionState.DISCONNECTED;
  private rawClient: WsRawClient | null = null;
  private stableCheckTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly config: WsClientConfig,
    private readonly reconnectManager: WsReconnectManager,
    private readonly heartbeat: WsHeartbeatMonitor,
    private readonly logger: ILogger,
  ) {
    super();
    this.setMaxListeners(50);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Initiates connection. No-op if already CONNECTING, CONNECTED, or STOPPED. */
  connect(): void {
    if (
      this._state === WsConnectionState.CONNECTED ||
      this._state === WsConnectionState.CONNECTING ||
      this._state === WsConnectionState.STOPPED
    ) {
      return;
    }
    this.transition(WsConnectionState.CONNECTING);
    this.spawnClient();
  }

  /** Graceful disconnect. Cancels any pending reconnect. */
  disconnect(): void {
    this.reconnectManager.cancel();
    this.heartbeat.stop();
    this.stopStableCheck();

    const prev = this._state;
    this.transition(WsConnectionState.DISCONNECTED);

    if (this.rawClient) {
      this.rawClient.close(1000, 'Client disconnect');
      this.rawClient = null;
    }

    if (prev !== WsConnectionState.DISCONNECTED) {
      this.emit('disconnected', 1000, 'Client disconnect');
    }
  }

  /**
   * Terminates the connection permanently. Transitions to STOPPED.
   * A new WsConnectionManager instance must be created to reconnect.
   */
  stop(): void {
    this.transition(WsConnectionState.STOPPED);
    this.reconnectManager.cancel();
    this.heartbeat.stop();
    this.stopStableCheck();

    if (this.rawClient) {
      this.rawClient.destroy();
      this.rawClient = null;
    }

    this.removeAllListeners();
  }

  /** Send a text frame. Returns false if not CONNECTED. */
  send(data: string): boolean {
    if (this._state !== WsConnectionState.CONNECTED || !this.rawClient) return false;
    return this.rawClient.send(data);
  }

  get state(): WsConnectionState {
    return this._state;
  }
  get isConnected(): boolean {
    return this._state === WsConnectionState.CONNECTED;
  }

  // ── Private — client lifecycle ─────────────────────────────────────────────

  private spawnClient(): void {
    if (this.rawClient) {
      this.rawClient.removeAllListeners();
      this.rawClient.destroy();
      this.rawClient = null;
    }

    const client = new WsRawClient(this.config.maxMessageSizeBytes);
    this.rawClient = client;

    client.once('open', () => {
      if (this._state === WsConnectionState.STOPPED) {
        client.close();
        return;
      }
      this.transition(WsConnectionState.CONNECTED);
      this.reconnectManager.onConnected();
      this.startStableCheck();
      this.heartbeat.start(
        () => client.ping(),
        () => {
          this.emit('heartbeatTimeout');
          this.logger.warn('Heartbeat timeout — forcing reconnect', 'WsConnectionManager');
          this.handleUnexpectedClose(4000, 'Heartbeat timeout');
        },
      );
      this.emit('connected');
    });

    client.on('message', (data: string, receivedAt: number) => {
      const byteLength = Buffer.byteLength(data, 'utf-8');
      const raw: WsRawMessage = { data, receivedAt, byteLength };
      this.emit('message', raw);
    });

    client.on('pong', () => this.heartbeat.recordPong());

    client.on('close', (code: number, reason: string) => {
      if (
        this._state === WsConnectionState.STOPPED ||
        this._state === WsConnectionState.DISCONNECTED
      ) {
        return;
      }
      this.heartbeat.stop();
      this.stopStableCheck();
      this.emit('disconnected', code, reason);
      this.handleUnexpectedClose(code, reason);
    });

    client.on('error', (error: Error) => {
      this.emit('error', error);
      // close event follows — no reconnect here
    });

    client.connect(this.config.url, this.config.headers);
  }

  private handleUnexpectedClose(code: number, reason: string): void {
    if (this._state === WsConnectionState.STOPPED) return;

    this.transition(WsConnectionState.RECONNECTING);

    const scheduled = this.reconnectManager.scheduleReconnect(() => {
      if (this._state === WsConnectionState.STOPPED) return;
      this.transition(WsConnectionState.CONNECTING);
      this.spawnClient();
    });

    if (!scheduled) {
      const msg = `Max reconnect attempts exceeded (code=${code}, reason="${reason}")`;
      this.transition(WsConnectionState.FAILED);
      this.emit('failed', msg);
      return;
    }

    this.emit('reconnecting', this.reconnectManager.currentAttempt, scheduled.delayMs);
  }

  // ── Private — stability check ──────────────────────────────────────────────

  private startStableCheck(): void {
    this.stableCheckTimer = setInterval(() => {
      this.reconnectManager.checkStability();
    }, 5_000);
  }

  private stopStableCheck(): void {
    if (this.stableCheckTimer !== null) {
      clearInterval(this.stableCheckTimer);
      this.stableCheckTimer = null;
    }
  }

  private transition(next: WsConnectionState): void {
    const prev = this._state;
    if (prev === next) return;
    this._state = next;
    this.emit('stateChange', prev, next);
    this.logger.debug(`WS state: ${prev} → ${next}`, 'WsConnectionManager');
  }
}
