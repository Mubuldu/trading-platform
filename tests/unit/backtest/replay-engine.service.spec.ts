import { ReplayEngineService } from '@modules/backtest/application/replay/replay-engine.service';
import { ReplayClock } from '@modules/backtest/application/replay/replay-clock';
import { BacktestState } from '@modules/backtest/domain/enums/backtest-state.enum';
import { BacktestCancelledError } from '@modules/backtest/domain/errors/backtest.errors';
import { ReplaySpeed } from '@modules/backtest/domain/enums/replay-mode.enum';
import { Candle } from '@modules/indicator/domain/models/candle.model';
import { Timeframe } from '@modules/indicator/domain/enums/timeframe.enum';

const mockLogger = {
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  verbose: jest.fn(),
} as any;

const makeCandle = (openTime: number): Candle => ({
  symbol: 'BTC/USDT',
  exchange: 'test',
  timeframe: Timeframe.ONE_HOUR,
  openTime,
  closeTime: openTime + 3_599_999,
  open: 50_000,
  high: 51_000,
  low: 49_000,
  close: 50_500,
  volume: 100,
  isClosed: true,
});

describe('ReplayEngineService', () => {
  let engine: ReplayEngineService;

  beforeEach(() => {
    jest.clearAllMocks();
    engine = new ReplayEngineService(mockLogger);
  });

  describe('replay', () => {
    it('calls onCandle for each candle in ascending time order', async () => {
      const times = [3_600_000, 7_200_000, 10_800_000];
      const shuffled = [times[2], times[0], times[1]].map(makeCandle);
      const visited: number[] = [];

      await engine.replay(
        shuffled,
        3_600_000,
        10_800_000,
        async (candle) => {
          visited.push(candle.openTime);
        },
        ReplaySpeed.UNLIMITED,
      );

      expect(visited).toEqual(times);
    });

    it('counts only active-window candles in candlesProcessed', async () => {
      const candles = [1_000_000, 3_600_000, 7_200_000].map(makeCandle);

      await engine.replay(candles, 3_600_000, 7_200_000, async () => {}, ReplaySpeed.UNLIMITED);

      expect(engine.getStats().candlesProcessed).toBe(2);
    });

    it('sets state to COMPLETED after successful replay', async () => {
      const candles = [3_600_000].map(makeCandle);
      await engine.replay(candles, 3_600_000, 3_600_000, async () => {}, ReplaySpeed.UNLIMITED);
      expect(engine.state).toBe(BacktestState.COMPLETED);
    });

    it('sets state to FAILED when handler throws', async () => {
      const candles = [3_600_000].map(makeCandle);
      await expect(
        engine.replay(
          candles,
          3_600_000,
          3_600_000,
          async () => {
            throw new Error('boom');
          },
          ReplaySpeed.UNLIMITED,
        ),
      ).rejects.toThrow('boom');
      expect(engine.state).toBe(BacktestState.FAILED);
    });

    it('handles empty candle list without error', async () => {
      await engine.replay([], 0, 0, async () => {}, ReplaySpeed.UNLIMITED);
      expect(engine.state).toBe(BacktestState.COMPLETED);
      expect(engine.getStats().candlesProcessed).toBe(0);
    });

    it('is deterministic — same input produces same visit order', async () => {
      const candles = [7_200_000, 3_600_000, 10_800_000].map(makeCandle);

      const run = async (): Promise<number[]> => {
        const visited: number[] = [];
        const e = new ReplayEngineService(mockLogger);
        await e.replay(
          candles,
          3_600_000,
          10_800_000,
          async (c) => {
            visited.push(c.openTime);
          },
          ReplaySpeed.UNLIMITED,
        );
        return visited;
      };

      const [r1, r2] = await Promise.all([run(), run()]);
      expect(r1).toEqual(r2);
    });
  });

  describe('cancel', () => {
    it('throws BacktestCancelledError when cancelled mid-replay', async () => {
      const candles = Array.from({ length: 10 }, (_, i) => makeCandle((i + 1) * 3_600_000));
      let processed = 0;

      const promise = engine.replay(
        candles,
        3_600_000,
        candles[candles.length - 1].openTime,
        async () => {
          processed++;
          if (processed === 3) engine.cancel();
        },
        ReplaySpeed.UNLIMITED,
      );

      await expect(promise).rejects.toThrow(BacktestCancelledError);
      expect(engine.state).toBe(BacktestState.CANCELLED);
      expect(processed).toBeLessThan(10);
    });
  });

  describe('getStats', () => {
    it('reports progress percent within [0, 100] during replay', async () => {
      const start = 3_600_000;
      const end = 7_200_000;
      const candles = [start, end].map(makeCandle);
      let midProgress = 0;

      await engine.replay(
        candles,
        start,
        end,
        async (_: Candle, clock: ReplayClock) => {
          if (clock.currentTime === start) midProgress = clock.progressPercent();
        },
        ReplaySpeed.UNLIMITED,
      );

      expect(midProgress).toBeGreaterThanOrEqual(0);
      expect(midProgress).toBeLessThanOrEqual(100);
    });
  });
});

describe('ReplayClock', () => {
  it('throws when advancing backwards', () => {
    const clock = new ReplayClock(1000, 5000);
    clock.advance(2000);
    expect(() => clock.advance(1500)).toThrow();
  });

  it('reports progressPercent correctly at midpoint', () => {
    const clock = new ReplayClock(0, 1000);
    clock.advance(500);
    expect(clock.progressPercent()).toBe(50);
  });

  it('caps progressPercent at 100 at end', () => {
    const clock = new ReplayClock(0, 1000);
    clock.advance(1000);
    expect(clock.progressPercent()).toBe(100);
  });

  it('returns 0 elapsed at start', () => {
    const clock = new ReplayClock(1000, 5000);
    expect(clock.elapsed()).toBe(0);
  });

  it('validates jumpTo stays within window', () => {
    const clock = new ReplayClock(1000, 5000);
    expect(() => clock.jumpTo(0)).toThrow();
    expect(() => clock.jumpTo(6000)).toThrow();
    expect(() => clock.jumpTo(3000)).not.toThrow();
  });
});
