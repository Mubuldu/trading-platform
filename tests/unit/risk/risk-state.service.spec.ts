import { RiskStateService } from '../../../src/modules/risk/application/services/risk-state.service';

function makeService(): RiskStateService {
  return new RiskStateService();
}

describe('RiskStateService', () => {
  describe('initEquity()', () => {
    it('sets peak and current equity on first call', () => {
      const svc = makeService();
      svc.initEquity(100_000);
      const m = svc.getMetrics();
      expect(m.peakEquity).toBe(100_000);
      expect(m.currentEquity).toBe(100_000);
    });

    it('does not overwrite after first call', () => {
      const svc = makeService();
      svc.initEquity(100_000);
      svc.initEquity(200_000);
      expect(svc.getMetrics().peakEquity).toBe(100_000);
    });
  });

  describe('recordTrade() — winning streak', () => {
    it('tracks consecutive wins', () => {
      const svc = makeService();
      svc.initEquity(100_000);
      svc.recordTrade(500);
      svc.recordTrade(300);
      svc.recordTrade(200);
      const m = svc.getMetrics();
      expect(m.consecutiveWins).toBe(3);
      expect(m.consecutiveLosses).toBe(0);
      expect(m.totalTrades).toBe(3);
      expect(m.winRate).toBeCloseTo(1.0);
    });

    it('resets consecutive wins after a loss', () => {
      const svc = makeService();
      svc.initEquity(100_000);
      svc.recordTrade(500);
      svc.recordTrade(500);
      svc.recordTrade(-100);
      expect(svc.getConsecutiveWins()).toBe(0);
      expect(svc.getConsecutiveLosses()).toBe(1);
    });
  });

  describe('recordTrade() — losing streak', () => {
    it('tracks consecutive losses', () => {
      const svc = makeService();
      svc.initEquity(100_000);
      svc.recordTrade(-200);
      svc.recordTrade(-300);
      svc.recordTrade(-150);
      const m = svc.getMetrics();
      expect(m.consecutiveLosses).toBe(3);
      expect(m.consecutiveWins).toBe(0);
      expect(m.dailyLoss).toBeCloseTo(650);
    });

    it('resets consecutive losses after a win', () => {
      const svc = makeService();
      svc.initEquity(100_000);
      svc.recordTrade(-200);
      svc.recordTrade(-200);
      svc.recordTrade(100);
      expect(svc.getConsecutiveLosses()).toBe(0);
      expect(svc.getConsecutiveWins()).toBe(1);
    });
  });

  describe('getCurrentDrawdownPercent()', () => {
    it('returns 0 when equity equals peak', () => {
      const svc = makeService();
      svc.initEquity(100_000);
      expect(svc.getCurrentDrawdownPercent()).toBe(0);
    });

    it('computes drawdown correctly after losses', () => {
      const svc = makeService();
      svc.initEquity(100_000);
      svc.recordTrade(-10_000);
      expect(svc.getCurrentDrawdownPercent()).toBeCloseTo(10);
    });

    it('flash crash — large sudden loss', () => {
      const svc = makeService();
      svc.initEquity(100_000);
      svc.recordTrade(-40_000);
      expect(svc.getCurrentDrawdownPercent()).toBeCloseTo(40);
    });

    it('does not go below 0 after recovery', () => {
      const svc = makeService();
      svc.initEquity(100_000);
      svc.recordTrade(-5_000);
      svc.recordTrade(10_000);
      expect(svc.getCurrentDrawdownPercent()).toBe(0);
    });
  });

  describe('getDailyLoss()', () => {
    it('sums losses within the day', () => {
      const svc = makeService();
      svc.initEquity(100_000);
      svc.recordTrade(-1_000);
      svc.recordTrade(500);
      svc.recordTrade(-2_000);
      expect(svc.getDailyLoss()).toBeCloseTo(3_000);
    });

    it('does not include wins in daily loss', () => {
      const svc = makeService();
      svc.initEquity(100_000);
      svc.recordTrade(500);
      expect(svc.getDailyLoss()).toBe(0);
    });
  });

  describe('kelly fraction', () => {
    it('returns 0 when no trades', () => {
      const svc = makeService();
      expect(svc.getMetrics().kellyFraction).toBe(0);
    });

    it('computes positive kelly with profitable win rate', () => {
      const svc = makeService();
      svc.initEquity(100_000);
      for (let i = 0; i < 6; i++) svc.recordTrade(200);
      for (let i = 0; i < 4; i++) svc.recordTrade(-100);
      const { kellyFraction } = svc.getMetrics();
      expect(kellyFraction).toBeGreaterThan(0);
    });
  });

  describe('emergency controls', () => {
    it('kill switch starts inactive', () => {
      const svc = makeService();
      expect(svc.isKillSwitchActive()).toBe(false);
    });

    it('triggerKillSwitch() activates', () => {
      const svc = makeService();
      svc.triggerKillSwitch();
      expect(svc.isKillSwitchActive()).toBe(true);
    });

    it('resetKillSwitch() deactivates', () => {
      const svc = makeService();
      svc.triggerKillSwitch();
      svc.resetKillSwitch();
      expect(svc.isKillSwitchActive()).toBe(false);
    });

    it('pauseTrading() and resume() work correctly', () => {
      const svc = makeService();
      svc.pauseTrading();
      expect(svc.isTradingPaused()).toBe(true);
      svc.resume();
      expect(svc.isTradingPaused()).toBe(false);
    });

    it('lockExposure() and resume() work correctly', () => {
      const svc = makeService();
      svc.lockExposure();
      expect(svc.isExposureLocked()).toBe(true);
      svc.resume();
      expect(svc.isExposureLocked()).toBe(false);
    });
  });

  describe('getDailyTradeCount()', () => {
    it('increments on each trade', () => {
      const svc = makeService();
      svc.recordTrade(100);
      svc.recordTrade(-50);
      svc.recordTrade(200);
      expect(svc.getDailyTradeCount()).toBe(3);
    });
  });
});

// ─── Redis persistence ────────────────────────────────────────────────────────
//
// These suites construct RiskStateService with a mocked RedisClientService and
// AppLoggerService to verify that control flags and daily state are written to
// (and restored from) Redis without blocking callers.
//
// Implementation note: client.set / del / hset are all called *synchronously*
// inside the fire-and-log helpers (only their .catch() subscriber is async),
// so no flush is needed before asserting on the mock call record.

type MockClient = {
  set: jest.Mock;
  del: jest.Mock;
  hset: jest.Mock;
  get: jest.Mock;
  hgetall: jest.Mock;
};

type MockLogger = {
  log: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
  debug: jest.Mock;
};

function makeMockClient(): MockClient {
  return {
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    hset: jest.fn().mockResolvedValue(1),
    get: jest.fn().mockResolvedValue(null),
    hgetall: jest.fn().mockResolvedValue(null),
  };
}

function makeMockLogger(): MockLogger {
  return {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
}

describe('RiskStateService — Redis persistence (control flags)', () => {
  let mockClient: MockClient;
  let mockRedis: { getClient: () => MockClient };
  let mockLogger: MockLogger;

  beforeEach(() => {
    mockClient = makeMockClient();
    mockRedis = { getClient: () => mockClient };
    mockLogger = makeMockLogger();
  });

  function makeSvc() {
    return new RiskStateService(mockRedis as any, mockLogger as any);
  }

  it('triggerKillSwitch() writes "1" to risk:state:kill-switch', () => {
    makeSvc().triggerKillSwitch();
    expect(mockClient.set).toHaveBeenCalledWith('risk:state:kill-switch', '1');
  });

  it('resetKillSwitch() deletes risk:state:kill-switch', () => {
    const svc = makeSvc();
    svc.triggerKillSwitch();
    mockClient.set.mockClear();
    svc.resetKillSwitch();
    expect(mockClient.del).toHaveBeenCalledWith('risk:state:kill-switch');
    expect(mockClient.set).not.toHaveBeenCalled();
  });

  it('pauseTrading() writes "1" to risk:state:trading-paused', () => {
    makeSvc().pauseTrading();
    expect(mockClient.set).toHaveBeenCalledWith('risk:state:trading-paused', '1');
  });

  it('lockExposure() writes "1" to risk:state:exposure-locked', () => {
    makeSvc().lockExposure();
    expect(mockClient.set).toHaveBeenCalledWith('risk:state:exposure-locked', '1');
  });

  it('resume() deletes both trading-paused and exposure-locked', () => {
    const svc = makeSvc();
    svc.pauseTrading();
    svc.lockExposure();
    mockClient.set.mockClear();
    svc.resume();
    expect(mockClient.del).toHaveBeenCalledWith('risk:state:trading-paused');
    expect(mockClient.del).toHaveBeenCalledWith('risk:state:exposure-locked');
  });

  it('triggerKillSwitch() also emits a warn log', () => {
    makeSvc().triggerKillSwitch();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Kill switch ENGAGED'),
      expect.any(String),
    );
  });

  it('resetKillSwitch() also emits a warn log', () => {
    const svc = makeSvc();
    svc.triggerKillSwitch();
    mockLogger.warn.mockClear();
    svc.resetKillSwitch();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Kill switch CLEARED'),
      expect.any(String),
    );
  });
});

describe('RiskStateService — Redis persistence (daily state)', () => {
  let mockClient: MockClient;
  let mockRedis: { getClient: () => MockClient };

  beforeEach(() => {
    mockClient = makeMockClient();
    mockRedis = { getClient: () => mockClient };
  });

  function makeSvc() {
    return new RiskStateService(mockRedis as any, makeMockLogger() as any);
  }

  it('recordTrade() HMSETs daily state to risk:state:daily', () => {
    const svc = makeSvc();
    svc.initEquity(100_000);
    svc.recordTrade(-750);
    expect(mockClient.hset).toHaveBeenCalledWith(
      'risk:state:daily',
      expect.objectContaining({ loss: '750', tradeCount: '1' }),
    );
  });

  it('daily hash reflects cumulative loss after multiple trades', () => {
    const svc = makeSvc();
    svc.initEquity(100_000);
    svc.recordTrade(-200);
    svc.recordTrade(-300);
    const calls = mockClient.hset.mock.calls as [string, Record<string, string>][];
    const lastArgs = calls[calls.length - 1][1];
    expect(lastArgs.loss).toBe('500');
    expect(lastArgs.tradeCount).toBe('2');
  });

  it('wins do not add to the daily loss hash field', () => {
    const svc = makeSvc();
    svc.initEquity(100_000);
    svc.recordTrade(1_000);
    const calls = mockClient.hset.mock.calls as [string, Record<string, string>][];
    const lastArgs = calls[calls.length - 1][1];
    expect(lastArgs.loss).toBe('0');
    expect(lastArgs.tradeCount).toBe('1');
  });
});

describe('RiskStateService — no-Redis graceful degradation', () => {
  let mockClient: MockClient;

  beforeEach(() => {
    mockClient = makeMockClient();
  });

  it('does not throw when Redis is absent', () => {
    const svc = new RiskStateService(undefined, makeMockLogger() as any);
    expect(() => svc.triggerKillSwitch()).not.toThrow();
    expect(() => svc.resetKillSwitch()).not.toThrow();
    expect(() => svc.pauseTrading()).not.toThrow();
    expect(() => svc.lockExposure()).not.toThrow();
    expect(() => svc.resume()).not.toThrow();
    expect(() => svc.recordTrade(-100)).not.toThrow();
  });

  it('never calls set/del/hset when Redis is absent', () => {
    // Pass the mock logger but no redis — the mock client must remain untouched
    const svc = new RiskStateService(undefined, makeMockLogger() as any);
    svc.triggerKillSwitch();
    svc.pauseTrading();
    svc.lockExposure();
    svc.recordTrade(-500);
    svc.resume();
    expect(mockClient.set).not.toHaveBeenCalled();
    expect(mockClient.del).not.toHaveBeenCalled();
    expect(mockClient.hset).not.toHaveBeenCalled();
  });

  it('in-memory state still works correctly without Redis', () => {
    const svc = new RiskStateService();
    svc.initEquity(100_000);
    svc.triggerKillSwitch();
    svc.recordTrade(-1_000);
    expect(svc.isKillSwitchActive()).toBe(true);
    expect(svc.getDailyLoss()).toBeCloseTo(1_000);
  });
});

// ─── onModuleInit() restore ───────────────────────────────────────────────────

describe('RiskStateService — onModuleInit() restore from Redis', () => {
  const MS_PER_DAY = 86_400_000;
  let mockClient: MockClient;
  let mockRedis: { getClient: () => MockClient };
  let mockLogger: MockLogger;

  beforeEach(() => {
    mockClient = makeMockClient();
    mockRedis = { getClient: () => mockClient };
    mockLogger = makeMockLogger();
  });

  function makeSvc() {
    return new RiskStateService(mockRedis as any, mockLogger as any);
  }

  it('restores kill switch when Redis key is "1"', async () => {
    mockClient.get.mockImplementation((key: string) =>
      Promise.resolve(key === 'risk:state:kill-switch' ? '1' : null),
    );
    const svc = makeSvc();
    await svc.onModuleInit();
    expect(svc.isKillSwitchActive()).toBe(true);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Kill switch RESTORED'),
      expect.any(String),
    );
  });

  it('restores trading-paused when Redis key is "1"', async () => {
    mockClient.get.mockImplementation((key: string) =>
      Promise.resolve(key === 'risk:state:trading-paused' ? '1' : null),
    );
    const svc = makeSvc();
    await svc.onModuleInit();
    expect(svc.isTradingPaused()).toBe(true);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Trading pause RESTORED'),
      expect.any(String),
    );
  });

  it('restores exposure-locked when Redis key is "1"', async () => {
    mockClient.get.mockImplementation((key: string) =>
      Promise.resolve(key === 'risk:state:exposure-locked' ? '1' : null),
    );
    const svc = makeSvc();
    await svc.onModuleInit();
    expect(svc.isExposureLocked()).toBe(true);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Exposure lock RESTORED'),
      expect.any(String),
    );
  });

  it('all three flags can be restored simultaneously', async () => {
    mockClient.get.mockResolvedValue('1'); // all keys return '1'
    const svc = makeSvc();
    await svc.onModuleInit();
    expect(svc.isKillSwitchActive()).toBe(true);
    expect(svc.isTradingPaused()).toBe(true);
    expect(svc.isExposureLocked()).toBe(true);
  });

  it('does not activate flags when Redis keys are null', async () => {
    // default mockClient.get already returns null
    const svc = makeSvc();
    await svc.onModuleInit();
    expect(svc.isKillSwitchActive()).toBe(false);
    expect(svc.isTradingPaused()).toBe(false);
    expect(svc.isExposureLocked()).toBe(false);
  });

  it('restores daily loss when stored dayStart is within today UTC', async () => {
    const todayTs = Date.now();
    mockClient.hgetall.mockResolvedValue({
      loss: '1500.50',
      tradeCount: '7',
      dayStart: String(todayTs),
    });
    const svc = makeSvc();
    await svc.onModuleInit();
    expect(svc.getDailyLoss()).toBeCloseTo(1500.5);
    expect(svc.getDailyTradeCount()).toBe(7);
  });

  it('skips daily restore when stored dayStart is in a prior UTC day', async () => {
    const now = Date.now();
    const todayDay = Math.floor(now / MS_PER_DAY);
    // Place dayStart 500ms into yesterday's UTC day
    const yesterdayTs = (todayDay - 1) * MS_PER_DAY + 500;
    mockClient.hgetall.mockResolvedValue({
      loss: '9999',
      tradeCount: '42',
      dayStart: String(yesterdayTs),
    });
    const svc = makeSvc();
    await svc.onModuleInit();
    expect(svc.getDailyLoss()).toBe(0);
    expect(svc.getDailyTradeCount()).toBe(0);
  });

  it('skips daily restore when hgetall returns null', async () => {
    // default mockClient.hgetall already returns null
    const svc = makeSvc();
    await svc.onModuleInit();
    expect(svc.getDailyLoss()).toBe(0);
  });

  it('warns and skips restore when Redis is absent', async () => {
    const svc = new RiskStateService(undefined, mockLogger as any);
    await svc.onModuleInit();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('WITHOUT Redis'),
      expect.any(String),
    );
    expect(svc.isKillSwitchActive()).toBe(false);
  });

  it('proceeds with clean state and logs error when Redis throws during restore', async () => {
    mockClient.get.mockRejectedValue(new Error('ECONNREFUSED'));
    const svc = makeSvc();
    await svc.onModuleInit();
    // State must be clean — a kill switch must NOT silently re-engage on error
    expect(svc.isKillSwitchActive()).toBe(false);
    expect(svc.getDailyLoss()).toBe(0);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to restore'),
      expect.anything(),
      expect.any(String),
    );
  });
});

// ─── UTC calendar-day rollover ────────────────────────────────────────────────
//
// Verifies the `isSameUtcDay` / `rollDayIfNeeded` fix: the window rolls at UTC
// calendar-day boundaries, not after 24 hours of elapsed time.

describe('RiskStateService — UTC calendar-day rollover', () => {
  const MS_PER_DAY = 86_400_000;

  /** Fast-forward a service's internal dayStart into a prior UTC day. */
  function backdateToYesterday(svc: RiskStateService): void {
    const todayDay = Math.floor(Date.now() / MS_PER_DAY);
    (svc as any).stats.dayStart = (todayDay - 1) * MS_PER_DAY + 500; // 500ms into yesterday UTC
  }

  /** Set a service's internal dayStart to earlier within the current UTC day. */
  function backdateToEarlierToday(svc: RiskStateService): void {
    const todayDay = Math.floor(Date.now() / MS_PER_DAY);
    (svc as any).stats.dayStart = todayDay * MS_PER_DAY; // exactly today's UTC midnight
  }

  it('getDailyLoss() resets to 0 after a UTC day boundary has passed', () => {
    const svc = makeService();
    svc.initEquity(100_000);
    svc.recordTrade(-500);
    backdateToYesterday(svc);
    // rollDayIfNeeded() fires inside getDailyLoss()
    expect(svc.getDailyLoss()).toBe(0);
  });

  it('getDailyTradeCount() resets to 0 after a UTC day boundary has passed', () => {
    const svc = makeService();
    svc.recordTrade(-100);
    svc.recordTrade(-200);
    backdateToYesterday(svc);
    expect(svc.getDailyTradeCount()).toBe(0);
  });

  it('does NOT roll when dayStart is earlier within the same UTC day', () => {
    const svc = makeService();
    svc.initEquity(100_000);
    svc.recordTrade(-500);
    // Back-date within today — still the same UTC day, no roll
    backdateToEarlierToday(svc);
    expect(svc.getDailyLoss()).toBeCloseTo(500);
    expect(svc.getDailyTradeCount()).toBe(1);
  });

  it('recordTrade() resets accumulated loss when crossing UTC midnight', () => {
    const svc = makeService();
    svc.initEquity(100_000);
    svc.recordTrade(-999);
    backdateToYesterday(svc);
    // This trade belongs to the new UTC day — previous loss must not carry over
    svc.recordTrade(-100);
    expect(svc.getDailyLoss()).toBeCloseTo(100);
    expect(svc.getDailyTradeCount()).toBe(1);
  });

  it('getMetrics() reflects the rolled-over daily values', () => {
    const svc = makeService();
    svc.initEquity(100_000);
    svc.recordTrade(-300);
    svc.recordTrade(-200);
    backdateToYesterday(svc);
    const m = svc.getMetrics();
    expect(m.dailyLoss).toBe(0);
    expect(m.dailyTradeCount).toBe(0);
    // Lifetime counters must NOT be reset by a day roll
    expect(m.totalTrades).toBe(2);
    expect(m.consecutiveLosses).toBe(2);
  });
});
