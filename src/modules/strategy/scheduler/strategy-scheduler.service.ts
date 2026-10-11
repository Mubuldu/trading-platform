import { Injectable, Inject } from '@nestjs/common';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { withTimeout } from '@common/resilience/timeout.util';
import { EventBusProvider } from '@infrastructure/providers/event-bus/event-bus.interface';
import { INFRASTRUCTURE_TOKENS } from '@infrastructure/infrastructure.tokens';
import { MarketTick, Trade } from '@modules/exchange/models/market.models';
import { ExecutionReport } from '@modules/exchange/models/trading.models';
import { Position } from '@modules/exchange/models/account.models';
import { Candle } from '@modules/indicator/domain/models/candle.model';
import { IStrategy, StrategyContext } from '../interfaces/strategy.interface';
import { Signal } from '../interfaces/signal.interface';
import { StrategySignalEvent } from '../domain/events/strategy-signal.event';
import { StrategyRegistryService } from '../registry/strategy-registry.service';

const DEFAULT_MAX_RUNTIME_MS = 5_000;
const DEFAULT_MAX_EVENTS_PER_SECOND = 100;

interface RateWindow {
  count: number;
  windowStart: number;
}

/**
 * StrategySchedulerService dispatches market events to all enabled strategies.
 *
 * Isolation guarantee: every strategy call is wrapped in try/catch. One strategy
 * throwing never prevents others from receiving the same event.
 *
 * Resource enforcement per strategy:
 *   maxRuntimeMs       — each hook call races against a timeout
 *   maxEventsPerSecond — calls exceeding the rate window are skipped
 *
 * maxCpuMs and maxMemoryBytes are tracked but not enforced — Node.js single-thread
 * model cannot isolate per-promise CPU/memory without Worker threads.
 */
@Injectable()
export class StrategySchedulerService {
  private readonly context = StrategySchedulerService.name;
  private readonly rateWindows = new Map<string, RateWindow>();
  private readonly skippedEvents = new Map<string, number>();

  constructor(
    private readonly registry: StrategyRegistryService,
    private readonly logger: AppLoggerService,
    @Inject(INFRASTRUCTURE_TOKENS.EVENT_BUS) private readonly eventBus: EventBusProvider,
  ) {}

  async dispatchTick(tick: MarketTick): Promise<void> {
    await this.dispatch('onTick', (s) => s.onTick(tick));
  }

  async dispatchTrade(trade: Trade): Promise<void> {
    await this.dispatch('onTrade', (s) => s.onTrade(trade));
  }

  async dispatchCandle(candle: Candle): Promise<void> {
    await this.dispatch('onCandle', (s) => s.onCandle(candle));
  }

  async dispatchOrderFilled(report: ExecutionReport): Promise<void> {
    await this.dispatch('onOrderFilled', (s) => s.onOrderFilled(report));
  }

  async dispatchOrderRejected(report: ExecutionReport): Promise<void> {
    await this.dispatch('onOrderRejected', (s) => s.onOrderRejected(report));
  }

  async dispatchPositionOpened(position: Position): Promise<void> {
    await this.dispatch('onPositionOpened', (s) => s.onPositionOpened(position));
  }

  async dispatchPositionClosed(position: Position): Promise<void> {
    await this.dispatch('onPositionClosed', (s) => s.onPositionClosed(position));
  }

  async dispatchSignalGeneration(context: StrategyContext): Promise<Signal[]> {
    const signals: Signal[] = [];
    const enabled = this.registry.getEnabled();

    await Promise.all(
      enabled.map(async (strategy) => {
        if (!this.checkRateLimit(strategy)) return;

        try {
          const maxMs = strategy.config.resourceLimits.maxRuntimeMs ?? DEFAULT_MAX_RUNTIME_MS;
          const signal = await withTimeout(() => strategy.generateSignal(context), maxMs, {
            operationName: `strategy:${strategy.id}:generateSignal`,
          });
          if (signal !== null) {
            signals.push(signal);
            await this.publishSignal(signal);
          }
        } catch (e) {
          this.logger.error(
            `Strategy "${strategy.id}" generateSignal failed: ${e instanceof Error ? e.message : String(e)}`,
            e instanceof Error ? e.stack : undefined,
            this.context,
          );
        }
      }),
    );

    return signals;
  }

  getSkippedEvents(strategyId: string): number {
    return this.skippedEvents.get(strategyId) ?? 0;
  }

  private async publishSignal(signal: Signal): Promise<void> {
    const result = await this.eventBus.publish(new StrategySignalEvent(signal));
    if (result.isErr()) {
      this.logger.error(
        `Failed to publish StrategySignalEvent for signal "${signal.signalId}": ${result.error.message}`,
        undefined,
        this.context,
      );
    }
  }

  private async dispatch(
    hookName: string,
    call: (strategy: IStrategy) => Promise<void>,
  ): Promise<void> {
    const enabled = this.registry.getEnabled();

    await Promise.all(
      enabled.map(async (strategy) => {
        if (!this.checkRateLimit(strategy)) return;

        try {
          const maxMs = strategy.config.resourceLimits.maxRuntimeMs ?? DEFAULT_MAX_RUNTIME_MS;
          await withTimeout(() => call(strategy), maxMs, {
            operationName: `strategy:${strategy.id}:${hookName}`,
          });
        } catch (e) {
          this.logger.error(
            `Strategy "${strategy.id}" ${hookName} failed: ${e instanceof Error ? e.message : String(e)}`,
            e instanceof Error ? e.stack : undefined,
            this.context,
          );
        }
      }),
    );
  }

  private checkRateLimit(strategy: IStrategy): boolean {
    const maxEps =
      strategy.config.resourceLimits.maxEventsPerSecond ?? DEFAULT_MAX_EVENTS_PER_SECOND;
    const now = Date.now();
    const window = this.rateWindows.get(strategy.id);

    if (!window || now - window.windowStart >= 1_000) {
      this.rateWindows.set(strategy.id, { count: 1, windowStart: now });
      return true;
    }

    if (window.count >= maxEps) {
      const prev = this.skippedEvents.get(strategy.id) ?? 0;
      this.skippedEvents.set(strategy.id, prev + 1);
      this.logger.warn(
        `Strategy "${strategy.id}" rate limit exceeded (${maxEps} eps), skipping event`,
        this.context,
      );
      return false;
    }

    window.count++;
    return true;
  }
}
