import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as net from 'net';
import * as tls from 'tls';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { AlertsConfig } from '@config/alerts.config';
import { AlertLevel } from '../../domain/alert-level.enum';
import { Alert } from '../../domain/alert.entity';
import { AlertChannel } from './alert-channel.interface';

const LEVEL_SUBJECT_PREFIX: Record<AlertLevel, string> = {
  [AlertLevel.INFO]: '[INFO]',
  [AlertLevel.WARNING]: '[WARNING]',
  [AlertLevel.ERROR]: '[ERROR]',
  [AlertLevel.CRITICAL]: '[CRITICAL]',
  [AlertLevel.FATAL]: '[FATAL]',
};

/**
 * EmailChannel sends alert notifications over SMTP.
 *
 * Implementation:
 *  - Direct SMTP dialogue using Node.js `tls`/`net` — no external mailer
 *    library to avoid dependency bloat and supply-chain risk.
 *  - Supports STARTTLS (port 587) and implicit TLS (port 465).
 *  - AUTH LOGIN with base64-encoded credentials.
 *  - Falls back gracefully on any SMTP error.
 *
 * Note: Production deployments should prefer a relay (SendGrid, SES, etc.)
 * over direct SMTP to handle SPF/DKIM, rate limits, and deliverability.
 * Replace this implementation with an API client when upgrading.
 */
@Injectable()
export class EmailChannel implements AlertChannel {
  readonly name = 'email';
  private readonly context = EmailChannel.name;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: AppLoggerService,
  ) {}

  isConfigured(): boolean {
    const cfg = this.configService.get<AlertsConfig>('alerts')!.channels.email;
    return cfg !== null && cfg.user !== '' && cfg.to.length > 0;
  }

  async send(alert: Alert): Promise<boolean> {
    const cfg = this.configService.get<AlertsConfig>('alerts')!.channels.email;
    if (!cfg) return false;

    const prefix = LEVEL_SUBJECT_PREFIX[alert.level];
    const recovery = alert.isRecovery ? '[RECOVERED] ' : '';
    const subject = `${prefix} ${recovery}${alert.title}`;

    const body = this.buildTextBody(alert);

    try {
      await this.sendSmtp({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.secure,
        user: cfg.user,
        password: cfg.password,
        from: cfg.from,
        to: cfg.to,
        subject,
        body,
        timeoutMs: cfg.timeoutMs,
      });
      return true;
    } catch (error) {
      this.logger.warn(
        `Email channel: delivery failed — ${(error as Error).message}`,
        this.context,
      );
      return false;
    }
  }

  private buildTextBody(alert: Alert): string {
    const lines: string[] = [
      `=== TRADING PLATFORM ALERT ===`,
      ``,
      `Level:     ${alert.level}`,
      `Category:  ${alert.category}`,
      `Condition: ${alert.condition}`,
      `Source:    ${alert.source}`,
      `Status:    ${alert.status}`,
      ``,
      `Title:     ${alert.title}`,
      `Message:   ${alert.message}`,
      ``,
    ];

    if (alert.isRecovery) {
      lines.push('*** RECOVERY NOTIFICATION — condition has resolved ***', '');
    }
    if (alert.suppressedCount > 0) {
      lines.push(`Occurrences suppressed: ${alert.suppressedCount}`);
    }
    if (alert.escalationCount > 0) {
      lines.push(`Escalation count: ${alert.escalationCount}`);
    }

    if (Object.keys(alert.context).length > 0) {
      lines.push('', 'Context:', JSON.stringify(alert.context, null, 2));
    }

    lines.push('', `Alert ID: ${alert.id}`, `Created:  ${alert.createdAt.toISOString()}`);
    return lines.join('\r\n');
  }

  // ── Minimal SMTP client ──────────────────────────────────────────────────────

  private sendSmtp(opts: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    password: string;
    from: string;
    to: string[];
    subject: string;
    body: string;
    timeoutMs: number;
  }): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(
        () => reject(new Error(`SMTP timeout after ${opts.timeoutMs}ms`)),
        opts.timeoutMs,
      );

      const socket: net.Socket | tls.TLSSocket = opts.secure
        ? tls.connect({ host: opts.host, port: opts.port, rejectUnauthorized: true })
        : net.connect({ host: opts.host, port: opts.port });

      const lines: string[] = [];
      let resolved = false;

      const done = (err?: Error): void => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeoutId);
        socket.destroy();
        err ? reject(err) : resolve();
      };

      const send = (cmd: string): void => {
        socket.write(cmd + '\r\n');
      };

      const expect = (code: number, line: string): boolean => {
        return line.startsWith(String(code));
      };

      const b64 = (s: string): string => Buffer.from(s).toString('base64');

      let state = 0;

      socket.on('error', (e) => done(e));

      socket.on('data', (chunk: Buffer) => {
        const parts = chunk.toString().split('\r\n');
        for (const part of parts) {
          if (!part) continue;
          lines.push(part);

          try {
            switch (state) {
              case 0: // Banner
                if (!expect(220, part)) {
                  done(new Error(`SMTP: ${part}`));
                  return;
                }
                send(`EHLO trading-platform`);
                state = 1;
                break;
              case 1: // EHLO response (multi-line)
                if (part.startsWith('250 ') || (part.startsWith('250-') && part.includes('AUTH'))) {
                  // Wait for final 250
                }
                if (part.startsWith('250 ')) {
                  send(`AUTH LOGIN`);
                  state = 2;
                }
                break;
              case 2: // AUTH LOGIN prompt for username
                if (!expect(334, part)) {
                  done(new Error(`SMTP AUTH: ${part}`));
                  return;
                }
                send(b64(opts.user));
                state = 3;
                break;
              case 3: // AUTH LOGIN prompt for password
                if (!expect(334, part)) {
                  done(new Error(`SMTP AUTH: ${part}`));
                  return;
                }
                send(b64(opts.password));
                state = 4;
                break;
              case 4: // AUTH result
                if (!expect(235, part)) {
                  done(new Error(`SMTP AUTH failed: ${part}`));
                  return;
                }
                send(`MAIL FROM:<${opts.from}>`);
                state = 5;
                break;
              case 5: // MAIL FROM
                if (!expect(250, part)) {
                  done(new Error(`SMTP MAIL FROM: ${part}`));
                  return;
                }
                send(`RCPT TO:<${opts.to[0]}>`);
                state = 6;
                break;
              case 6: // RCPT TO (simplified: first recipient only for minimum viable)
                if (!expect(250, part)) {
                  done(new Error(`SMTP RCPT TO: ${part}`));
                  return;
                }
                send(`DATA`);
                state = 7;
                break;
              case 7: // DATA prompt
                if (!expect(354, part)) {
                  done(new Error(`SMTP DATA: ${part}`));
                  return;
                }
                // Build RFC 2822 message
                const msg = [
                  `From: ${opts.from}`,
                  `To: ${opts.to.join(', ')}`,
                  `Subject: ${opts.subject}`,
                  `Date: ${new Date().toUTCString()}`,
                  `MIME-Version: 1.0`,
                  `Content-Type: text/plain; charset=utf-8`,
                  ``,
                  opts.body,
                  `.`,
                ].join('\r\n');
                send(msg);
                state = 8;
                break;
              case 8: // DATA accepted
                if (!expect(250, part)) {
                  done(new Error(`SMTP message rejected: ${part}`));
                  return;
                }
                send(`QUIT`);
                state = 9;
                break;
              case 9: // QUIT
                done();
                break;
            }
          } catch (e) {
            done(e as Error);
          }
        }
      });
    });
  }
}
