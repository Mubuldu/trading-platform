import { Injectable } from '@nestjs/common';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { Candle } from '@modules/indicator/domain/models/candle.model';
import { IndicatorValue } from '@modules/indicator/domain/models/indicator-value.model';
import { IIndicatorCalculator } from '@modules/indicator/interfaces/indicator-calculator.interface';
import { IStrategy, StrategyContext } from '@modules/strategy/interfaces/strategy.interface';
import { StrategyLoaderService } from '@modules/strategy/loader/strategy-loader.service';
import { StrategyRegistryService } from '@modules/strategy/registry/strategy-registry.service';
import { OrderSide, OrderStatus } from '@modules/exchange/enums/order.enums';
import { ExecutionReport } from '@modules/exchange/models/trading.models';
import { NormalizedSymbol } from '@modules/exchange/models/common.model';
import { ExchangeId } from '@modules/exchange/enums/exchange.enums';
import { BacktestConfig } from '../../domain/models/backtest-config.model';
import { BacktestResult } from '../../domain/models/backtest-result.model';
import { BacktestState } from '../../domain/enums/backtest-state.enum';
import { BacktestStrategyLoadFailedError } from '../../domain/errors/backtest.errors';
import { ReplaySpeed } from '../../domain/enums/replay-mode.enum';
import { HistoricalLoaderFactoryService } from '../historical-loader/historical-loader-factory.service';
import { ExecutionSimulatorService } from '../execution-simulator/execution-simulator.service';
import { BacktestPortfolioTrackerService } from '../portfolio/backtest-portfolio-tracker.service';
import { EquityCurveBuilderService } from '../portfolio/equity-curve-builder.service';
import { ReportGeneratorService } from '../reports/report-generator.service';
import { ReplayEngineService } from '../replay/replay-engine.service';
import { ReplayClock } from '../replay/replay-clock';
import { BacktestIndicatorFactory } from './backtest-indicator-factory';
import { BacktestRiskEvaluator } from './backtest-risk-evaluator';
import { BacktestSession } from './backtest-session';
import { SimulatedFill } from '../execution-simulator/fill-model';

@Injectable()
export class BacktestEngineService {
  private readonly context = BacktestEngineService.name;

  constructor(
    private readonly logger: AppLoggerService,
    private readonly loaderFactory: HistoricalLoaderFactoryService,
    private readonly replayEngine: ReplayEngineService,
    private readonly indicatorFactory: BacktestIndicatorFactory,
    private readonly riskEvaluator: BacktestRiskEvaluator,
    private readonly executionSimulator: ExecutionSimulatorService,
    private readonly portfolioTracker: BacktestPortfolioTrackerService,
    private readonly equityCurve: EquityCurveBuilderService,
    private readonly reportGenerator: ReportGeneratorService,
    private readonly strategyLoader: StrategyLoaderService,
    private readonly strategyRegistry: StrategyRegistryService,
  ) {}

  async run(config: BacktestConfig): Promise<BacktestResult> {
    const session = new BacktestSession(config);

    this.logger.log(
      `Backtest session ${session.sessionId} starting: ${config.symbol} ${config.timeframe} [${new Date(config.startTime).toISOString()} → ${new Date(config.endTime).toISOString()}]`,
      this.context,
    );

    try {
      return await this.executeSession(session, config);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      session.markFailed(message);
      this.logger.error(
        `Backtest session ${session.sessionId} failed: ${message}`,
        (e as Error).stack,
        this.context,
      );
      return session.toResult();
    }
  }

  private async executeSession(
    session: BacktestSession,
    config: BacktestConfig,
  ): Promise<BacktestResult> {
    session.state = BacktestState.LOADING;

    const loader = this.loaderFactory.resolve(config.dataSource);
    const warmupStart = config.startTime - this.estimateWarmupMs(config);

    const allCandles = await loader.load({
      symbol: config.symbol,
      exchange: config.exchange,
      timeframe: config.timeframe,
      startTime: warmupStart,
      endTime: config.endTime,
    });

    this.logger.log(
      `Loaded ${allCandles.length} candles (including ${config.warmupCandles} warmup bars)`,
      this.context,
    );

    const strategies = await this.loadStrategies(config);

    this.executionSimulator.configure(config);
    this.portfolioTracker.initialize(config.initialCapitalUsd);
    this.equityCurve.initialize(config.initialCapitalUsd);

    const calculators = this.indicatorFactory.createForSymbol(
      config.symbol,
      config.exchange,
      config.timeframe,
      config.extraIndicatorPeriods,
    );

    session.state = BacktestState.WARMING_UP;

    let activePhase = false;
    let warmupComplete = false;

    await this.replayEngine.replay(
      allCandles,
      config.startTime,
      config.endTime,
      async (candle: Candle, _clock: ReplayClock) => {
        const isActive = candle.openTime >= config.startTime;

        if (isActive && !activePhase) {
          activePhase = true;
          session.state = BacktestState.RUNNING;
          this.logger.log(
            `Warmup complete — active trading begins at ${new Date(candle.openTime).toISOString()}`,
            this.context,
          );
        }

        const fills = this.executionSimulator.processAllOrdersForCandle(candle);
        for (const fill of fills) {
          this.portfolioTracker.applyFill(fill);
          await this.notifyStrategiesOfFill(strategies, fill, candle);
        }

        for (const calc of calculators) {
          calc.update(candle);
        }

        const allWarmedUp = calculators.every((c) => c.isWarmedUp());
        if (!warmupComplete && allWarmedUp) {
          warmupComplete = true;
        }

        if (!isActive || !warmupComplete) {
          this.portfolioTracker.updateMarkPrice(candle.symbol, candle.close, candle.openTime);
          return;
        }

        session.candlesProcessed++;

        const indicators = this.buildIndicatorMap(calculators);

        const strategyContext: StrategyContext = {
          exchange: config.exchange,
          symbol: config.symbol,
          timestamp: candle.closeTime,
          indicators,
        };

        for (const strategy of strategies) {
          try {
            await strategy.onCandle(candle);
          } catch (e) {
            this.logger.warn(
              `Strategy "${strategy.id}" onCandle error: ${(e as Error).message}`,
              this.context,
            );
          }
        }

        for (const strategy of strategies) {
          let signal;
          try {
            signal = await strategy.generateSignal(strategyContext);
          } catch (e) {
            this.logger.warn(
              `Strategy "${strategy.id}" generateSignal error: ${(e as Error).message}`,
              this.context,
            );
            continue;
          }

          if (!signal) continue;

          const portfolioState = this.portfolioTracker.getState();
          const decision = this.riskEvaluator.evaluate(signal, portfolioState, {
            initialCapitalUsd: config.initialCapitalUsd,
            maxPositionSizePercent: config.maxPositionSizePercent,
            maxDailyLossPercent: config.maxDailyLossPercent,
            enableRiskChecks: config.enableRiskChecks,
          });

          if (!decision.approved) {
            this.logger.debug(
              `Signal rejected for ${strategy.id}: ${decision.reason}`,
              this.context,
            );
            continue;
          }

          const markPrice = candle.close;
          // For exit (SELL) orders, use the actual open position quantity so we
          // never over-fill and create phantom second trades from a single entry.
          let quantity: number;
          if (decision.side === OrderSide.SELL) {
            const portfolioState2 = this.portfolioTracker.getState();
            const openPos = [...portfolioState2.openPositions.values()].find(
              (p) => p.symbol === signal.symbol,
            );
            quantity = openPos ? openPos.quantity : 0;
          } else {
            quantity = markPrice > 0 ? decision.sizeUsd / markPrice : 0;
          }
          if (quantity <= 0) continue;

          this.executionSimulator.submitOrder({
            strategyId: signal.strategyId,
            symbol: signal.symbol,
            side: decision.side,
            type: decision.orderType,
            quantity,
            price: decision.price,
            stopPrice: decision.stopPrice,
            trailingDeltaPercent: decision.trailingDeltaPercent,
            submittedAtBarTime: candle.closeTime,
          });
        }

        this.portfolioTracker.updateMarkPrice(candle.symbol, candle.close, candle.openTime);

        this.equityCurve.record(
          candle.closeTime,
          this.portfolioTracker.getEquity(),
          this.portfolioTracker.getCash(),
          this.portfolioTracker.getUnrealizedPnl(),
        );
      },
      ReplaySpeed.UNLIMITED,
    );

    await this.cleanupStrategies(strategies);

    const report = this.reportGenerator.generate(
      config,
      config.initialCapitalUsd,
      this.portfolioTracker.getEquity(),
      this.portfolioTracker.getCompletedTrades(),
      this.executionSimulator.getAllOrders(),
      this.equityCurve.getPoints(),
      session.candlesProcessed,
      this.portfolioTracker.getTotalCommission(),
      this.portfolioTracker.getTotalSlippage(),
    );

    session.markCompleted();

    this.logger.log(
      `Backtest session ${session.sessionId} completed: ${session.candlesProcessed} candles, ` +
        `${report.totalTrades} trades, return=${report.totalReturnPercent.toFixed(2)}%, ` +
        `maxDD=${report.maxDrawdownPercent.toFixed(2)}%, sharpe=${report.sharpeRatio.toFixed(2)}`,
      this.context,
    );

    return session.toResult(report);
  }

  private async loadStrategies(config: BacktestConfig): Promise<IStrategy[]> {
    const loaded: IStrategy[] = [];

    for (const entry of config.strategies) {
      try {
        // Append a short session suffix to the strategyId so backtest instances
        // never collide with the live strategy that is already registered under
        // the same bare id (e.g. "trend-following-v1").  cleanupStrategies()
        // unregisters this suffixed id at the end of the run.
        const backtestConfig = {
          ...entry.config,
          strategyId: `${entry.config.strategyId}_bt_${config.sessionId.slice(0, 8)}`,
        };
        const strategy = await this.strategyLoader.load(entry.strategyType, backtestConfig);
        loaded.push(strategy);
        this.logger.log(
          `Loaded strategy "${entry.strategyType}" (${backtestConfig.strategyId})`,
          this.context,
        );
      } catch (e) {
        throw new BacktestStrategyLoadFailedError(entry.strategyType, (e as Error).message);
      }
    }

    return loaded;
  }

  private async cleanupStrategies(strategies: IStrategy[]): Promise<void> {
    for (const strategy of strategies) {
      try {
        await strategy.shutdown();
        this.strategyRegistry.unregister(strategy.id);
      } catch {
        // Ignore shutdown errors during cleanup
      }
    }
  }

  private buildIndicatorMap(
    calculators: IIndicatorCalculator[],
  ): ReadonlyMap<string, IndicatorValue> {
    const map = new Map<string, IndicatorValue>();
    for (const calc of calculators) {
      if (!calc.isWarmedUp()) continue;
      const result = calc.calculate();
      if (result.isOk()) {
        map.set(calc.id, result.value);
      }
    }
    return map;
  }

  private async notifyStrategiesOfFill(
    strategies: IStrategy[],
    fill: SimulatedFill,
    _candle: Candle,
  ): Promise<void> {
    const order = fill.order;

    const executionReport: ExecutionReport = {
      symbol: order.symbol as NormalizedSymbol,
      exchangeId: ExchangeId.PAPER_TRADING,
      timestamp: new Date(fill.fillTime),
      receivedAt: new Date(fill.fillTime),
      correlationId: undefined,
      exchangeOrderId: order.orderId,
      side: order.side,
      type: order.type,
      previousStatus: OrderStatus.NEW,
      currentStatus: fill.isPartial ? OrderStatus.PARTIALLY_FILLED : OrderStatus.FILLED,
      lastExecutedQuantity: fill.filledQuantity,
      lastExecutedPrice: fill.fillPrice,
      cumulativeFilledQuantity: order.filledQuantity,
      cumulativeQuoteQuantity: order.filledQuantity * fill.fillPrice,
      commissionAmount: fill.commission,
      commissionAsset: 'USDT',
      isMaker: fill.isMaker,
      workingTime: new Date(fill.fillTime),
    };

    const targetStrategyId = order.strategyId;

    for (const strategy of strategies) {
      if (strategy.id !== targetStrategyId) continue;
      try {
        if (fill.order.status === 'FILLED' || !fill.isPartial) {
          await strategy.onOrderFilled(executionReport);
        }
      } catch (e) {
        this.logger.warn(
          `Strategy "${strategy.id}" onOrderFilled error: ${(e as Error).message}`,
          this.context,
        );
      }
    }
  }

  private estimateWarmupMs(config: BacktestConfig): number {
    const barDurations: Record<string, number> = {
      '1m': 60_000,
      '5m': 300_000,
      '15m': 900_000,
      '1h': 3_600_000,
    };
    const barMs = barDurations[config.timeframe] ?? 60_000;
    return config.warmupCandles * barMs;
  }
}
