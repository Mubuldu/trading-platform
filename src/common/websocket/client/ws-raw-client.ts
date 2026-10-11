import { EventEmitter } from 'events';
import WebSocket = require('ws');

/**
 * WsRawClient wraps a single ws.WebSocket instance with:
 *  - Max message size enforcement (rejects before dispatch)
 *  - Typed EventEmitter events
 *  - Clean lifecycle: connect → [messages] → close/destroy
 *
 * No reconnect logic lives here — that belongs in WsConnectionManager.
 * No heartbeat logic lives here — that belongs in WsHeartbeatMonitor.
 *
 * Events:
 *  open                         — handshake complete
 *  close (code, reason)         — connection closed
 *  error (Error)                — socket error (close follows)
 *  message (data, receivedAt)   — text message received
 *  ping (Buffer)                — protocol PING frame received (ws auto-pongs)
 *  pong (Buffer)                — protocol PONG frame received
 */
export class WsRawClient extends EventEmitter {
  private ws: InstanceType<typeof WebSocket> | null = null;
  private readonly maxMessageSizeBytes: number;

  constructor(maxMessageSizeBytes: number) {
    super();
    this.maxMessageSizeBytes = maxMessageSizeBytes;
  }

  connect(url: string, headers?: Readonly<Record<string, string>>): void {
    if (this.ws) this.internalDestroy();

    this.ws = new WebSocket(url, { headers: headers as Record<string, string> });

    this.ws.once('open', () => this.emit('open'));

    this.ws.on('close', (code: number, reason: Buffer) => {
      this.ws = null;
      this.emit('close', code, reason.toString('utf-8'));
    });

    this.ws.on('error', (error: Error) => {
      this.emit('error', error);
    });

    this.ws.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
      const str = isBinary ? (data as Buffer).toString('utf-8') : String(data);
      const byteLen = Buffer.byteLength(str, 'utf-8');

      if (byteLen > this.maxMessageSizeBytes) {
        this.emit(
          'error',
          new Error(
            `Message rejected: size ${byteLen} bytes exceeds limit ${this.maxMessageSizeBytes} bytes`,
          ),
        );
        return;
      }

      this.emit('message', str, Date.now());
    });

    this.ws.on('ping', (data: Buffer) => this.emit('ping', data));
    this.ws.on('pong', (data: Buffer) => this.emit('pong', data));
  }

  send(data: string): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(data);
    return true;
  }

  /** Send a protocol-level PING frame. The remote will reply with PONG. */
  ping(data?: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.ping(data);
    }
  }

  /** Graceful close — gives the remote a chance to acknowledge. */
  close(code = 1000, reason = ''): void {
    if (this.ws) {
      this.ws.close(code, reason);
    }
  }

  /** Forceful termination — use when graceful close is not possible. */
  destroy(): void {
    this.internalDestroy();
    this.removeAllListeners();
  }

  get readyState(): number {
    return this.ws ? this.ws.readyState : WebSocket.CLOSED;
  }

  get isOpen(): boolean {
    return this.readyState === WebSocket.OPEN;
  }

  private internalDestroy(): void {
    if (this.ws) {
      try {
        this.ws.terminate();
      } catch {
        /* already closed */
      }
      this.ws.removeAllListeners();
      this.ws = null;
    }
  }
}
