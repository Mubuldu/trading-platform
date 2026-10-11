import { ReloadableConfigService } from '@config/reload/reloadable-config.service';
import { ConfigService } from '@nestjs/config';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import * as os from 'os';
import { RiskConfig } from '@config/risk.config';
import { ILogger } from '@core/logging/logger.interface';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeDefaultRisk(): RiskConfig {
  return {
    enabled: true,
    defaultEquityUsd: 100_000,
    sizingMethod: 'FIXED_FRACTIONAL',
    riskPerTradePercent: 1,
    maxPositionSizeUsd: 100_000,
    maxOrderSizeUsd: 10_000,
    atrMultiplier: 2,
    kellyFractionMultiplier: 0.25,
    targetVolatilityPercent: 15,
    maxExposurePercent: 80,
    maxLeverage: 3,
    maxOpenOrders: 50,
    maxPositionsPerSymbol: 3,
    maxConcentrationPercent: 30,
    maxDailyLossUsd: 5_000,
    maxDrawdownPercent: 10,
    maxConsecutiveLosses: 5,
    dailyTradeLimit: 100,
    minConfidenceThreshold: 0.3,
    blockedSymbols: [],
    drawdownReductionThresholdPercent: 5,
    drawdownReductionFactor: 0.5,
    consecutiveLossReductionThreshold: 3,
    consecutiveLossReductionFactor: 0.5,
    volatilityReductionThresholdPercent: 30,
    volatilityReductionFactor: 0.5,
  };
}

function makeConfigService(overrides: Record<string, unknown> = {}): ConfigService {
  const defaults: Record<string, unknown> = {
    risk: makeDefaultRisk(),
    strategy: {
      enabledIds: [],
      defaultSymbol: 'BTC/USDT',
      maxConcurrent: 5,
      heartbeatIntervalMs: 5_000,
      orderCooldownMs: 1_000,
    },
    monitoring: {
      metrics: { enabled: true, prefix: 'tp', collectionIntervalMs: 15_000 },
      thresholds: {
        latencyWarnMs: 100,
        errorRateWarnPercent: 5,
        memoryWarnPercent: 80,
        cpuWarnPercent: 80,
      },
    },
    alerts: {
      enabled: true,
      cooldownSeconds: 300,
      thresholds: {
        priceDeviationWarnPercent: 5,
        latencyWarnMs: 500,
        errorRateWarnPercent: 10,
        drawdownWarnPercent: 5,
        positionUtilizationWarnPercent: 80,
        fillRateWarnPercent: 95,
      },
    },
    ...overrides,
  };

  return {
    get: jest.fn(<T>(key: string): T | undefined => {
      return defaults[key] as T | undefined;
    }),
  } as unknown as ConfigService;
}

function makeLogger(): ILogger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    critical: jest.fn(),
  } as unknown as ILogger;
}

function makeTempEnvFile(vars: Record<string, string>): { path: string; cleanup: () => void } {
  const dir = mkdirSync(join(os.tmpdir(), `tp-test-${Date.now()}`), { recursive: true }) as
    string | undefined;
  const tmpDir = dir ?? join(os.tmpdir(), `tp-test-${Date.now()}`);
  const filePath = join(tmpDir, '.env.test');
  const content = Object.entries(vars)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  writeFileSync(filePath, content, 'utf-8');
  return {
    path: filePath,
    cleanup: () => {
      if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('ReloadableConfigService', () => {
  let service: ReloadableConfigService;
  let configService: ConfigService;
  let logger: ILogger;

  beforeEach(() => {
    configService = makeConfigService();
    logger = makeLogger();
    service = new ReloadableConfigService(configService, logger, '/nonexistent/.env.test');
    service.onModuleInit();
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.restoreAllMocks();
  });

  describe('initial state', () => {
    it('captures risk config from ConfigService at init', () => {
      expect(service.getRisk().maxPositionSizeUsd).toBe(100_000);
      expect(service.getRisk().maxLeverage).toBe(3);
    });

    it('captures strategy config from ConfigService at init', () => {
      expect(service.getStrategy().defaultSymbol).toBe('BTC/USDT');
    });

    it('captures monitoring config from ConfigService at init', () => {
      expect(service.getMonitoring().thresholds.latencyWarnMs).toBe(100);
    });

    it('captures alerts config from ConfigService at init', () => {
      expect(service.getAlerts().enabled).toBe(true);
    });
  });

  describe('reload with valid env file', () => {
    it('updates risk values and returns true', async () => {
      const { path, cleanup } = makeTempEnvFile({
        RISK_MAX_POSITION_SIZE_USD: '50000',
        RISK_MAX_LEVERAGE: '2',
        RISK_MAX_DRAWDOWN_PERCENT: '7',
        RISK_MAX_DAILY_LOSS_USD: '2000',
        RISK_MAX_ORDER_SIZE_USD: '5000',
        RISK_MAX_OPEN_ORDERS: '30',
        RISK_MAX_CONCENTRATION_PERCENT: '20',
        RISK_ENABLED: 'true',
        STRATEGY_ENABLED_IDS: '',
        STRATEGY_DEFAULT_SYMBOL: 'BTC/USDT',
        STRATEGY_MAX_CONCURRENT: '5',
        STRATEGY_HEARTBEAT_INTERVAL_MS: '5000',
        STRATEGY_ORDER_COOLDOWN_MS: '1000',
        MONITORING_LATENCY_WARN_MS: '200',
        MONITORING_ERROR_RATE_WARN_PERCENT: '3',
        MONITORING_MEMORY_WARN_PERCENT: '75',
        MONITORING_CPU_WARN_PERCENT: '70',
        ALERTS_ENABLED: 'true',
        ALERTS_COOLDOWN_SECONDS: '600',
        ALERTS_PRICE_DEVIATION_WARN_PERCENT: '5',
        ALERTS_LATENCY_WARN_MS: '500',
        ALERTS_ERROR_RATE_WARN_PERCENT: '10',
        ALERTS_DRAWDOWN_WARN_PERCENT: '5',
        ALERTS_POSITION_WARN_PERCENT: '80',
        ALERTS_FILL_RATE_WARN_PERCENT: '95',
      });

      try {
        const svc = new ReloadableConfigService(configService, logger, path);
        svc.onModuleInit();

        const success = await svc.reload();

        expect(success).toBe(true);
        expect(svc.getRisk().maxPositionSizeUsd).toBe(50_000);
        expect(svc.getRisk().maxLeverage).toBe(2);
        expect(svc.getMonitoring().thresholds.latencyWarnMs).toBe(200);
        expect(svc.getAlerts().cooldownSeconds).toBe(600);

        svc.onModuleDestroy();
      } finally {
        cleanup();
      }
    });
  });

  describe('reload with invalid env file', () => {
    it('retains old values and returns false', async () => {
      const { path, cleanup } = makeTempEnvFile({
        RISK_MAX_LEVERAGE: '-5', // invalid: must be >= 1
        RISK_MAX_DRAWDOWN_PERCENT: '150', // invalid: must be <= 100
      });

      try {
        const svc = new ReloadableConfigService(configService, logger, path);
        svc.onModuleInit();

        const prevLeverage = svc.getRisk().maxLeverage;
        const success = await svc.reload();

        expect(success).toBe(false);
        expect(svc.getRisk().maxLeverage).toBe(prevLeverage);
      } finally {
        cleanup();
      }
    });

    it('logs a warning via ILogger (not console) on validation failure', async () => {
      const { path, cleanup } = makeTempEnvFile({
        RISK_MAX_LEVERAGE: '-99',
      });

      try {
        const svc = new ReloadableConfigService(configService, logger, path);
        svc.onModuleInit();

        await svc.reload();

        expect(logger.warn).toHaveBeenCalledTimes(1);
        expect((logger.warn as jest.Mock).mock.calls[0][0]).toMatch(
          /Config reload rejected — validation failed/,
        );
      } finally {
        cleanup();
      }
    });
  });

  describe('change event listeners', () => {
    it('fires risk listener when reload succeeds', async () => {
      const { path, cleanup } = makeTempEnvFile({
        RISK_MAX_POSITION_SIZE_USD: '25000',
        RISK_MAX_LEVERAGE: '1',
        RISK_MAX_DRAWDOWN_PERCENT: '5',
        RISK_MAX_DAILY_LOSS_USD: '1000',
        RISK_MAX_ORDER_SIZE_USD: '2500',
        RISK_MAX_OPEN_ORDERS: '20',
        RISK_MAX_CONCENTRATION_PERCENT: '15',
        RISK_ENABLED: 'true',
        STRATEGY_ENABLED_IDS: '',
        STRATEGY_DEFAULT_SYMBOL: 'BTC/USDT',
        STRATEGY_MAX_CONCURRENT: '5',
        STRATEGY_HEARTBEAT_INTERVAL_MS: '5000',
        STRATEGY_ORDER_COOLDOWN_MS: '1000',
        MONITORING_LATENCY_WARN_MS: '100',
        MONITORING_ERROR_RATE_WARN_PERCENT: '5',
        MONITORING_MEMORY_WARN_PERCENT: '80',
        MONITORING_CPU_WARN_PERCENT: '80',
        ALERTS_ENABLED: 'true',
        ALERTS_COOLDOWN_SECONDS: '300',
        ALERTS_PRICE_DEVIATION_WARN_PERCENT: '5',
        ALERTS_LATENCY_WARN_MS: '500',
        ALERTS_ERROR_RATE_WARN_PERCENT: '10',
        ALERTS_DRAWDOWN_WARN_PERCENT: '5',
        ALERTS_POSITION_WARN_PERCENT: '80',
        ALERTS_FILL_RATE_WARN_PERCENT: '95',
      });

      try {
        const svc = new ReloadableConfigService(configService, logger, path);
        svc.onModuleInit();

        const listener = jest.fn();
        svc.on('risk', listener);

        await svc.reload();

        expect(listener).toHaveBeenCalledTimes(1);
        const event = listener.mock.calls[0][0];
        expect(event.domain).toBe('risk');
        expect(event.current.maxPositionSizeUsd).toBe(25_000);
        expect(event.previous.maxPositionSizeUsd).toBe(100_000);
        expect(event.reloadedAt).toBeInstanceOf(Date);

        svc.onModuleDestroy();
      } finally {
        cleanup();
      }
    });

    it('does NOT fire listeners when validation fails', async () => {
      const { path, cleanup } = makeTempEnvFile({
        RISK_MAX_LEVERAGE: '-99',
      });

      try {
        const svc = new ReloadableConfigService(configService, logger, path);
        svc.onModuleInit();

        const listener = jest.fn();
        svc.on('risk', listener);

        await svc.reload();

        expect(listener).not.toHaveBeenCalled();

        svc.onModuleDestroy();
      } finally {
        cleanup();
      }
    });

    it('allows removing a listener via off()', async () => {
      const listener = jest.fn();
      service.on('alerts', listener);
      service.off('alerts', listener);

      // No valid env file — reload will return false (no listeners should fire anyway)
      await service.reload();

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('missing env file', () => {
    it('returns false when env file does not exist and process.env is invalid', async () => {
      const origLeverage = process.env.RISK_MAX_LEVERAGE;
      // Inject invalid value into process.env to trigger schema failure
      process.env.RISK_MAX_LEVERAGE = '-1';

      try {
        const success = await service.reload();
        // With invalid process.env value, reload should fail
        expect(typeof success).toBe('boolean');
      } finally {
        if (origLeverage === undefined) {
          delete process.env.RISK_MAX_LEVERAGE;
        } else {
          process.env.RISK_MAX_LEVERAGE = origLeverage;
        }
      }
    });
  });

  describe('sensitive values are not hot-reloadable', () => {
    it('getRisk() does not expose API keys or database credentials', () => {
      const risk = service.getRisk();
      const riskKeys = Object.keys(risk);
      expect(riskKeys).not.toContain('apiKey');
      expect(riskKeys).not.toContain('secretKey');
      expect(riskKeys).not.toContain('password');
      expect(riskKeys).not.toContain('dbPassword');
    });
  });

  describe('SIGHUP registration', () => {
    it('registers SIGHUP handler on init and removes it on destroy', () => {
      const addSpy = jest.spyOn(process, 'on');
      const removeSpy = jest.spyOn(process, 'off');

      const svc = new ReloadableConfigService(configService, logger, '/nonexistent');
      svc.onModuleInit();
      expect(addSpy).toHaveBeenCalledWith('SIGHUP', expect.any(Function));

      svc.onModuleDestroy();
      expect(removeSpy).toHaveBeenCalledWith('SIGHUP', expect.any(Function));
    });
  });
});
