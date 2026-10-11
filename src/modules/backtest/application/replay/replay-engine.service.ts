import { Injectable } from '@nestjs/common';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { Candle } from '@modules/indicator/domain/models/candle.model';
import { BacktestState } from '../../domain/enums/backtest-state.enum';
import { BacktestCancelledError } from '../../domain/errors/backtest.errors';
import { ReplayClock } from './replay-clock';
import { ReplaySpeedController } from './replay-speed';
import { ReplaySpeed } from '../../domain/enums/replay-mode.enum';

export type CandleHandler = (candle: Candle, clock: ReplayClock) => Promise<void>;

export interface ReplayStats {
  readonly candlesProcessed: number;
  readonly startedAt: number;
  readonly elapsedMs: number;
  readonly progressPercent: number;
  readonly state: BacktestState;
}

@Injectable()
export class ReplayEngineService {
  private readonly context = ReplayEngineService.name;
  private _state: BacktestState = BacktestState.IDLE;
  private _candlesProcessed = 0;
  private _startedAt = 0;
  private _cancelled = false;
  private _clock: ReplayClock | null = null;
  private readonly _speedController = new ReplaySpeedController(ReplaySpeed.UNLIMITED);

  constructor(private readonly logger: AppLoggerService) {}

  async replay(
    candles: Candle[],
    startTime: number,
    endTime: number,
    onCandle: CandleHandler,
    speed: ReplaySpeed = ReplaySpeed.UNLIMITED,
  ): Promise<void> {
    this._state = BacktestState.RUNNING;
    this._candlesProcessed = 0;
    this._startedAt = Date.now();
    this._cancelled = false;
    this._speedController.setSpeed(speed);

    const sorted = [...candles].sort((a, b) => a.openTime - b.openTime);
    const firstCandleTime = sorted.length > 0 ? sorted[0].openTime : startTime;
    this._clock = new ReplayClock(Math.min(firstCandleTime, startTime), endTime);

    this.logger.log(
      `Replay started: ${sorted.length} candles, window [${new Date(startTime).toISOString()} → ${new Date(endTime).toISOString()}]`,
      this.context,
    );

    try {
      for (const candle of sorted) {
        if (this._cancelled) {
          this._state = BacktestState.CANCELLED;
          throw new BacktestCancelledError('replay');
        }

        while (this._speedController.isPaused && !this._cancelled) {
          await this.sleep(50);
        }

        this._clock.advance(candle.openTime);
        await onCandle(candle, this._clock);

        if (candle.openTime >= startTime) {
          this._candlesProcessed++;
        }

        await this._speedController.waitForNextBar(this.estimateBarDurationMs(candle));

        if (this._candlesProcessed % 1_000 === 0 && this._candlesProcessed > 0) {
          this.logger.debug(
            `Replay progress: ${this._candlesProcessed}/${sorted.length} candles (${this._clock.progressPercent().toFixed(1)}%)`,
            this.context,
          );
        }
      }

      this._state = BacktestState.COMPLETED;
      this.logger.log(
        `Replay completed: ${this._candlesProcessed} candles processed in ${Date.now() - this._startedAt}ms`,
        this.context,
      );
    } catch (e) {
      if (!(e instanceof BacktestCancelledError)) {
        this._state = BacktestState.FAILED;
      }
      throw e;
    }
  }

  pause(): void {
    this._speedController.pause();
    this._state = BacktestState.PAUSED;
    this.logger.log('Replay paused', this.context);
  }

  resume(): void {
    this._speedController.resume();
    this._state = BacktestState.RUNNING;
    this.logger.log('Replay resumed', this.context);
  }

  cancel(): void {
    this._cancelled = true;
    this.logger.log('Replay cancellation requested', this.context);
  }

  setSpeed(speed: ReplaySpeed): void {
    this._speedController.setSpeed(speed);
  }

  stepForward(): void {
    this._speedController.resume();
    this._speedController.pause();
  }

  getStats(): ReplayStats {
    return {
      candlesProcessed: this._candlesProcessed,
      startedAt: this._startedAt,
      elapsedMs: Date.now() - this._startedAt,
      progressPercent: this._clock?.progressPercent() ?? 0,
      state: this._state,
    };
  }

  get state(): BacktestState {
    return this._state;
  }

  private estimateBarDurationMs(candle: Candle): number {
    return candle.closeTime - candle.openTime + 1;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
