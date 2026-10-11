import { AlertEngineService } from '@modules/alerts/application/services/alert-engine.service';
import { AlertRateLimiterService } from '@modules/alerts/application/services/alert-rate-limiter.service';
import { AlertEscalationService } from '@modules/alerts/application/services/alert-escalation.service';
import { AlertDispatcherService } from '@modules/alerts/application/services/alert-dispatcher.service';
import { AlertStoreService } from '@modules/alerts/application/services/alert-store.service';
import { AlertLevel } from '@modules/alerts/domain/alert-level.enum';
import { AlertCategory } from '@modules/alerts/domain/alert-category.enum';
import { AlertCondition } from '@modules/alerts/domain/alert-condition.enum';
import { Alert, RaiseAlertInput } from '@modules/alerts/domain/alert.entity';
import { ConfigService } from '@nestjs/config';
import { AppLoggerService } from '@core/logging/app-logger.service';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeAlert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: 'alert-1',
    level: AlertLevel.ERROR,
    category: AlertCategory.EXCHANGE,
    condition: AlertCondition.EXCHANGE_DISCONNECT,
    title: 'Exchange disconnected',
    message: 'Connection lost',
    source: 'BinanceAdapter',
    fingerprint: 'fp-1234',
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

function makeInput(overrides: Partial<RaiseAlertInput> = {}): RaiseAlertInput {
  return {
    level: AlertLevel.ERROR,
    category: AlertCategory.EXCHANGE,
    condition: AlertCondition.EXCHANGE_DISCONNECT,
    title: 'Exchange disconnected',
    message: 'WebSocket stream dropped',
    source: 'BinanceAdapter',
    ...overrides,
  };
}

// ── Test suite ─────────────────────────────────────────────────────────────

describe('AlertEngineService', () => {
  let engine: AlertEngineService;
  let rateLimiter: jest.Mocked<AlertRateLimiterService>;
  let escalation: jest.Mocked<AlertEscalationService>;
  let dispatcher: jest.Mocked<AlertDispatcherService>;
  let store: jest.Mocked<AlertStoreService>;
  let configService: jest.Mocked<ConfigService>;
  let logger: jest.Mocked<AppLoggerService>;

  const fingerprint = AlertRateLimiterService.buildFingerprint(
    AlertCategory.EXCHANGE,
    AlertCondition.EXCHANGE_DISCONNECT,
    'BinanceAdapter',
  );

  beforeEach(() => {
    rateLimiter = {
      checkCooldown: jest
        .fn()
        .mockResolvedValue({ suppressed: false, suppressedCount: 0, cooldownRemainingSeconds: 0 }),
      recordRaise: jest.fn().mockResolvedValue(undefined),
      incrementSuppressedCount: jest.fn().mockResolvedValue(1),
      clearCooldown: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<AlertRateLimiterService>;

    jest.spyOn(AlertRateLimiterService, 'buildFingerprint').mockReturnValue(fingerprint);

    escalation = {
      evaluate: jest.fn().mockReturnValue({ shouldEscalate: false, targetLevel: AlertLevel.ERROR }),
      escalate: jest.fn(),
    } as unknown as jest.Mocked<AlertEscalationService>;

    dispatcher = {
      dispatch: jest.fn().mockResolvedValue({ delivered: ['discord'], failed: [], skipped: [] }),
    } as unknown as jest.Mocked<AlertDispatcherService>;

    store = {
      save: jest.fn().mockImplementation((a: Alert) => Promise.resolve(a)),
      update: jest.fn().mockImplementation((a: Alert) => Promise.resolve(a)),
      findOpenByFingerprint: jest.fn().mockResolvedValue(null),
      findOpenByCondition: jest.fn().mockResolvedValue(null),
      acknowledge: jest.fn(),
      resolve: jest.fn(),
    } as unknown as jest.Mocked<AlertStoreService>;

    configService = {
      get: jest.fn().mockReturnValue({ enabled: true }),
    } as unknown as jest.Mocked<ConfigService>;

    logger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as jest.Mocked<AppLoggerService>;

    engine = new AlertEngineService(
      configService,
      logger,
      rateLimiter,
      escalation,
      dispatcher,
      store,
    );
    engine.onModuleInit();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── Fresh alert ───────────────────────────────────────────────────────────

  describe('raise() — fresh alert (outside cooldown)', () => {
    it('saves the alert and returns suppressed=false, notified=true', async () => {
      const result = await engine.raise(makeInput());

      expect(result).not.toBeNull();
      expect(result!.suppressed).toBe(false);
      expect(result!.notified).toBe(true);
      expect(result!.escalated).toBe(false);
      expect(store.save).toHaveBeenCalledTimes(1);
    });

    it('records cooldown before dispatch', async () => {
      await engine.raise(makeInput());
      expect(rateLimiter.recordRaise).toHaveBeenCalledWith(fingerprint);
    });

    it('fires dispatch asynchronously (fire-and-forget)', async () => {
      // dispatch should be called but we don't await it from raise()
      await engine.raise(makeInput());
      // Give the microtask queue a chance to run
      await new Promise((r) => setImmediate(r));
      expect(dispatcher.dispatch).toHaveBeenCalled();
    });
  });

  // ── Suppressed alert ──────────────────────────────────────────────────────

  describe('raise() — suppressed alert (within cooldown)', () => {
    beforeEach(() => {
      rateLimiter.checkCooldown.mockResolvedValue({
        suppressed: true,
        suppressedCount: 1,
        cooldownRemainingSeconds: 200,
      });
      store.findOpenByFingerprint.mockResolvedValue(makeAlert());
    });

    it('returns suppressed=true, notified=false', async () => {
      const result = await engine.raise(makeInput());

      expect(result!.suppressed).toBe(true);
      expect(result!.notified).toBe(false);
      expect(result!.escalated).toBe(false);
    });

    it('does not save a new alert record', async () => {
      await engine.raise(makeInput());
      expect(store.save).not.toHaveBeenCalled();
    });

    it('increments the suppression counter', async () => {
      await engine.raise(makeInput());
      expect(rateLimiter.incrementSuppressedCount).toHaveBeenCalledWith(fingerprint);
    });

    it('does not dispatch when suppressed without escalation', async () => {
      await engine.raise(makeInput());
      await new Promise((r) => setImmediate(r));
      expect(dispatcher.dispatch).not.toHaveBeenCalled();
    });
  });

  // ── Escalation ────────────────────────────────────────────────────────────

  describe('raise() — escalation path', () => {
    const existingAlert = makeAlert({ level: AlertLevel.WARNING, suppressedCount: 2 });
    const escalatedAlert = makeAlert({ level: AlertLevel.ERROR, escalationCount: 1 });

    beforeEach(() => {
      rateLimiter.checkCooldown.mockResolvedValue({
        suppressed: true,
        suppressedCount: 3,
        cooldownRemainingSeconds: 100,
      });
      rateLimiter.incrementSuppressedCount.mockResolvedValue(3);
      store.findOpenByFingerprint.mockResolvedValue(existingAlert);
      escalation.evaluate.mockReturnValue({ shouldEscalate: true, targetLevel: AlertLevel.ERROR });
      escalation.escalate.mockReturnValue(escalatedAlert);
    });

    it('returns escalated=true, notified=true', async () => {
      const result = await engine.raise(makeInput());
      expect(result!.escalated).toBe(true);
      expect(result!.notified).toBe(true);
    });

    it('resets the cooldown after escalation', async () => {
      await engine.raise(makeInput());
      expect(rateLimiter.recordRaise).toHaveBeenCalledWith(existingAlert.fingerprint);
    });

    it('dispatches the escalated alert', async () => {
      await engine.raise(makeInput());
      await new Promise((r) => setImmediate(r));
      expect(dispatcher.dispatch).toHaveBeenCalled();
    });
  });

  // ── Recovery ──────────────────────────────────────────────────────────────

  describe('raise() — recovery condition', () => {
    it('auto-resolves the matching open alert', async () => {
      const openAlert = makeAlert({ condition: AlertCondition.EXCHANGE_DISCONNECT });
      store.findOpenByCondition.mockResolvedValue(openAlert);
      store.resolve.mockResolvedValue(openAlert);

      await engine.raise(
        makeInput({ condition: AlertCondition.EXCHANGE_RECONNECTED, level: AlertLevel.INFO }),
      );

      expect(store.resolve).toHaveBeenCalledWith(expect.objectContaining({ id: openAlert.id }));
    });

    it('clears the cooldown on recovery', async () => {
      const openAlert = makeAlert();
      store.findOpenByCondition.mockResolvedValue(openAlert);
      store.resolve.mockResolvedValue(openAlert);

      await engine.raise(
        makeInput({ condition: AlertCondition.EXCHANGE_RECONNECTED, level: AlertLevel.INFO }),
      );

      expect(rateLimiter.clearCooldown).toHaveBeenCalledWith(openAlert.fingerprint);
    });

    it('saves a recovery alert with is_recovery=true', async () => {
      store.findOpenByCondition.mockResolvedValue(null);

      await engine.raise(
        makeInput({ condition: AlertCondition.EXCHANGE_RECONNECTED, level: AlertLevel.INFO }),
      );

      expect(store.save).toHaveBeenCalledWith(
        expect.objectContaining({ isRecovery: true, status: 'resolved' }),
      );
    });

    it('handles missing open alert gracefully (idempotent)', async () => {
      store.findOpenByCondition.mockResolvedValue(null);

      const result = await engine.raise(
        makeInput({ condition: AlertCondition.EXCHANGE_RECONNECTED, level: AlertLevel.INFO }),
      );

      expect(result).not.toBeNull();
      expect(store.resolve).not.toHaveBeenCalled();
    });
  });

  // ── Disabled engine ────────────────────────────────────────────────────────

  describe('raise() — alerts disabled', () => {
    it('returns null without touching any service', async () => {
      configService.get.mockReturnValue({ enabled: false });
      engine.onModuleInit(); // reload config

      const result = await engine.raise(makeInput());
      expect(result).toBeNull();
      expect(store.save).not.toHaveBeenCalled();
      expect(dispatcher.dispatch).not.toHaveBeenCalled();
    });
  });

  // ── Error resilience ───────────────────────────────────────────────────────

  describe('error resilience', () => {
    it('never throws even if the store explodes', async () => {
      store.save.mockRejectedValue(new Error('DB crash'));

      const result = await engine.raise(makeInput());
      // Engine absorbs the error and returns null
      expect(result).toBeNull();
    });

    it('never throws even if the rate limiter explodes', async () => {
      rateLimiter.checkCooldown.mockRejectedValue(new Error('Redis crash'));

      const result = await engine.raise(makeInput());
      expect(result).toBeNull();
    });
  });

  // ── Flood conditions ───────────────────────────────────────────────────────

  describe('flood conditions', () => {
    it('handles 100 concurrent raises without throwing', async () => {
      store.findOpenByFingerprint.mockResolvedValue(makeAlert());
      rateLimiter.checkCooldown.mockResolvedValue({
        suppressed: true,
        suppressedCount: 5,
        cooldownRemainingSeconds: 280,
      });

      const raises = Array.from({ length: 100 }, () => engine.raise(makeInput()));
      await expect(Promise.all(raises)).resolves.not.toThrow();
    });

    it('rate-limits correctly: only first raise triggers store.save', async () => {
      // First call: not suppressed
      rateLimiter.checkCooldown
        .mockResolvedValueOnce({
          suppressed: false,
          suppressedCount: 0,
          cooldownRemainingSeconds: 0,
        })
        .mockResolvedValue({ suppressed: true, suppressedCount: 1, cooldownRemainingSeconds: 299 });

      store.findOpenByFingerprint.mockResolvedValueOnce(null).mockResolvedValue(makeAlert());

      for (let i = 0; i < 5; i++) {
        await engine.raise(makeInput());
      }

      expect(store.save).toHaveBeenCalledTimes(1);
    });
  });

  // ── Notification failures ──────────────────────────────────────────────────

  describe('notification failures', () => {
    it('does not fail raise() when dispatcher returns failed channels', async () => {
      dispatcher.dispatch.mockResolvedValue({
        delivered: [],
        failed: ['discord', 'slack'],
        skipped: [],
      });

      const result = await engine.raise(makeInput());
      expect(result).not.toBeNull();
      expect(result!.notified).toBe(true); // raise() fired — notification was attempted
    });

    it('absorbs dispatcher exceptions silently', async () => {
      dispatcher.dispatch.mockRejectedValue(new Error('Network error'));

      await engine.raise(makeInput());
      await new Promise((r) => setImmediate(r));

      expect(logger.warn).toHaveBeenCalled();
    });
  });
});
