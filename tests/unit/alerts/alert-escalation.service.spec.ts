import { AlertEscalationService } from '@modules/alerts/application/services/alert-escalation.service';
import { AlertLevel } from '@modules/alerts/domain/alert-level.enum';
import { AlertCategory } from '@modules/alerts/domain/alert-category.enum';
import { AlertCondition } from '@modules/alerts/domain/alert-condition.enum';
import { Alert } from '@modules/alerts/domain/alert.entity';
import { ConfigService } from '@nestjs/config';
import { AppLoggerService } from '@core/logging/app-logger.service';

function makeAlert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: 'test-id',
    level: AlertLevel.WARNING,
    category: AlertCategory.EXCHANGE,
    condition: AlertCondition.EXCHANGE_DISCONNECT,
    title: 'Test Alert',
    message: 'Test message',
    source: 'TestService',
    fingerprint: 'abc123',
    status: 'open',
    context: {},
    suppressedCount: 0,
    escalationCount: 0,
    notificationChannels: [],
    notificationSentAt: null,
    acknowledgedBy: null,
    acknowledgedAt: null,
    resolvedAt: null,
    resolutionNote: null,
    isRecovery: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('AlertEscalationService', () => {
  let service: AlertEscalationService;

  beforeEach(() => {
    const configService = {
      get: jest.fn().mockReturnValue({
        escalationThreshold: 3,
        escalationWindowSeconds: 900,
      }),
    } as unknown as ConfigService;

    const logger = {
      warn: jest.fn(),
    } as unknown as AppLoggerService;

    service = new AlertEscalationService(configService, logger);
  });

  // ── evaluate ───────────────────────────────────────────────────────────────

  describe('evaluate()', () => {
    it('does not escalate when suppressedCount < threshold', () => {
      const alert = makeAlert({ level: AlertLevel.WARNING });
      const decision = service.evaluate(alert, 2);
      expect(decision.shouldEscalate).toBe(false);
    });

    it('escalates at exactly the threshold', () => {
      const alert = makeAlert({ level: AlertLevel.WARNING });
      const decision = service.evaluate(alert, 3);
      expect(decision.shouldEscalate).toBe(true);
      expect(decision.targetLevel).toBe(AlertLevel.ERROR);
    });

    it('escalates at each multiple of threshold (6, 9, ...)', () => {
      const alert = makeAlert({ level: AlertLevel.INFO });
      expect(service.evaluate(alert, 6).shouldEscalate).toBe(true);
      expect(service.evaluate(alert, 9).shouldEscalate).toBe(true);
      expect(service.evaluate(alert, 12).shouldEscalate).toBe(true);
    });

    it('does not escalate at non-multiples (4, 5, 7, 8...)', () => {
      const alert = makeAlert({ level: AlertLevel.INFO });
      [4, 5, 7, 8, 10, 11].forEach((count) => {
        expect(service.evaluate(alert, count).shouldEscalate).toBe(false);
      });
    });

    it('never escalates a FATAL alert', () => {
      const alert = makeAlert({ level: AlertLevel.FATAL });
      const decision = service.evaluate(alert, 99);
      expect(decision.shouldEscalate).toBe(false);
      expect(decision.targetLevel).toBe(AlertLevel.FATAL);
    });

    it('escalates INFO → WARNING → ERROR → CRITICAL → FATAL correctly', () => {
      const levels = [AlertLevel.INFO, AlertLevel.WARNING, AlertLevel.ERROR, AlertLevel.CRITICAL];
      const expected = [
        AlertLevel.WARNING,
        AlertLevel.ERROR,
        AlertLevel.CRITICAL,
        AlertLevel.FATAL,
      ];

      levels.forEach((level, i) => {
        const alert = makeAlert({ level });
        const decision = service.evaluate(alert, 3);
        expect(decision.targetLevel).toBe(expected[i]);
      });
    });
  });

  // ── escalate ───────────────────────────────────────────────────────────────

  describe('escalate()', () => {
    it('returns a new alert with elevated level', () => {
      const alert = makeAlert({ level: AlertLevel.WARNING, escalationCount: 0 });
      const escalated = service.escalate(alert, AlertLevel.ERROR);
      expect(escalated.level).toBe(AlertLevel.ERROR);
    });

    it('increments escalationCount', () => {
      const alert = makeAlert({ escalationCount: 1 });
      const escalated = service.escalate(alert, AlertLevel.CRITICAL);
      expect(escalated.escalationCount).toBe(2);
    });

    it('prepends escalation marker to the message', () => {
      const alert = makeAlert({ message: 'Connection dropped', escalationCount: 0 });
      const escalated = service.escalate(alert, AlertLevel.ERROR);
      expect(escalated.message).toContain('[Escalated');
      expect(escalated.message).toContain('Connection dropped');
    });

    it('does not mutate the original alert', () => {
      const alert = makeAlert({ level: AlertLevel.WARNING, escalationCount: 0 });
      const escalated = service.escalate(alert, AlertLevel.ERROR);
      expect(alert.level).toBe(AlertLevel.WARNING);
      expect(alert.escalationCount).toBe(0);
      expect(escalated).not.toBe(alert);
    });

    it('updates updatedAt timestamp', () => {
      const before = new Date(Date.now() - 1000);
      const alert = makeAlert({ updatedAt: before });
      const escalated = service.escalate(alert, AlertLevel.ERROR);
      expect(escalated.updatedAt.getTime()).toBeGreaterThan(before.getTime());
    });
  });
});
