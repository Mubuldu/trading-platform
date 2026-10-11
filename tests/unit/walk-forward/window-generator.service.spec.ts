import { WindowGeneratorService } from '@modules/walk-forward/application/window-generator.service';
import { OptimizationMetric } from '@modules/walk-forward/domain/enums/optimization-metric.enum';
import { WindowType } from '@modules/walk-forward/domain/enums/window-type.enum';
import { WalkForwardConfig } from '@modules/walk-forward/domain/models/walk-forward-config.model';
import { DataSourceType } from '@modules/backtest/domain/enums/data-source-type.enum';
import { Timeframe } from '@modules/indicator/domain/enums/timeframe.enum';

const BAR_MS = 3_600_000;

function makeConfig(overrides: Partial<WalkForwardConfig> = {}): WalkForwardConfig {
  return {
    runId: 'test-run',
    startTime: BAR_MS * 1,
    endTime: BAR_MS * 100,
    baseBacktestConfig: {
      symbol: 'BTC/USDT',
      exchange: 'test',
      timeframe: Timeframe.ONE_HOUR,
      warmupCandles: 0,
      initialCapitalUsd: 100_000,
      commission: { makerBps: 0, takerBps: 0 },
      slippage: { fixedBps: 0, volumeParticipationRate: 0.5, maxSlippageBps: 0 },
      dataSource: DataSourceType.CSV,
      enableRiskChecks: false,
      maxPositionSizePercent: 10,
      maxDailyLossPercent: 5,
      fillOnClose: false,
    },
    strategyType: 'mock',
    baseStrategyConfig: {
      strategyId: 'mock',
      name: 'Mock',
      version: '1.0.0',
      parameters: {},
      riskProfile: {
        maxPositionSizePercent: 10,
        maxDrawdownPercent: 20,
        stopLossPercent: 5,
        takeProfitPercent: 10,
        maxOpenOrders: 1,
      },
      enabledSymbols: [],
      enabledSessions: [],
      resourceLimits: {},
    },
    windowType: WindowType.ROLLING,
    trainWindowMs: BAR_MS * 30,
    testWindowMs: BAR_MS * 10,
    parameterGrid: {},
    optimizationMetric: OptimizationMetric.SHARPE,
    minTradesRequired: 0,
    ...overrides,
  };
}

describe('WindowGeneratorService', () => {
  let service: WindowGeneratorService;

  beforeEach(() => {
    service = new WindowGeneratorService();
  });

  describe('ROLLING windows', () => {
    it('generates the correct number of windows', () => {
      // startTime=1h, endTime=100h, train=30h, test=10h, step=10h
      // First testEnd = 1 + 30 + 10 = 41h
      // Last valid testEnd = 91h (91 <= 100)
      // 41, 51, 61, 71, 81, 91 → 6 windows
      const windows = service.generate(makeConfig());
      expect(windows.length).toBe(6);
    });

    it('assigns sequential indexes', () => {
      const windows = service.generate(makeConfig());
      windows.forEach((w, i) => expect(w.index).toBe(i));
    });

    it('trainEnd equals testStart', () => {
      const windows = service.generate(makeConfig());
      windows.forEach((w) => expect(w.trainEndTime).toBe(w.testStartTime));
    });

    it('each test window is the configured size', () => {
      const config = makeConfig();
      const windows = service.generate(config);
      windows.forEach((w) => expect(w.testEndTime - w.testStartTime).toBe(config.testWindowMs));
    });

    it('each train window is the configured size (rolling)', () => {
      const config = makeConfig();
      const windows = service.generate(config);
      windows.forEach((w) => expect(w.trainEndTime - w.trainStartTime).toBe(config.trainWindowMs));
    });

    it('test windows are contiguous with custom step', () => {
      const config = makeConfig({ stepMs: BAR_MS * 5 });
      const windows = service.generate(config);
      // Each window's testStart should be 5h after the previous testStart
      for (let i = 1; i < windows.length; i++) {
        expect(windows[i].testStartTime - windows[i - 1].testStartTime).toBe(BAR_MS * 5);
      }
    });

    it('returns empty array when range is too small', () => {
      const config = makeConfig({ endTime: BAR_MS * 30 }); // 30h total, needs 40h minimum
      const windows = service.generate(config);
      expect(windows.length).toBe(0);
    });

    it('includes the last window when testEnd exactly equals endTime', () => {
      // startTime=1h, endTime=41h, train=30h, test=10h → testEnd=41 = endTime → should include
      const config = makeConfig({ endTime: BAR_MS * 41 });
      const windows = service.generate(config);
      expect(windows.length).toBeGreaterThanOrEqual(1);
      expect(windows[0].testEndTime).toBe(BAR_MS * 41);
    });
  });

  describe('ANCHORED windows', () => {
    it('train always starts at config.startTime', () => {
      const config = makeConfig({ windowType: WindowType.ANCHORED });
      const windows = service.generate(config);
      windows.forEach((w) => expect(w.trainStartTime).toBe(config.startTime));
    });

    it('train window grows with each step', () => {
      const config = makeConfig({ windowType: WindowType.ANCHORED });
      const windows = service.generate(config);
      for (let i = 1; i < windows.length; i++) {
        expect(windows[i].trainEndTime).toBeGreaterThan(windows[i - 1].trainEndTime);
      }
    });

    it('produces same number of windows as ROLLING for equal sizes', () => {
      const rolling = service.generate(makeConfig({ windowType: WindowType.ROLLING }));
      const anchored = service.generate(makeConfig({ windowType: WindowType.ANCHORED }));
      expect(anchored.length).toBe(rolling.length);
    });

    it('test window boundaries match ROLLING exactly', () => {
      const rolling = service.generate(makeConfig({ windowType: WindowType.ROLLING }));
      const anchored = service.generate(makeConfig({ windowType: WindowType.ANCHORED }));
      rolling.forEach((rw, i) => {
        expect(anchored[i].testStartTime).toBe(rw.testStartTime);
        expect(anchored[i].testEndTime).toBe(rw.testEndTime);
      });
    });
  });
});
