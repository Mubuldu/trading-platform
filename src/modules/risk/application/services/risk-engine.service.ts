import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { RiskConfig } from '@config/risk.config';
import { EventBusProvider } from '@infrastructure/providers/event-bus/event-bus.interface';
import { INFRASTRUCTURE_TOKENS } from '@infrastructure/infrastructure.tokens';
import { StrategySignalEvent } from '@modules/strategy/domain/events/strategy-signal.event';
import { Signal } from '@modules/strategy/interfaces/signal.interface';
import { SignalDirection } from '@modules/strategy/domain/enums/signal-direction.enum';
import { RiskDecision } from '../../domain/enums/risk-decision.enum';
import { RiskViolation } from '../../domain/enums/risk-violation.enum';
import { RiskDecisionModel } from '../../domain/models/risk-decision.model';
import { PortfolioSnapshot } from '../../domain/models/portfolio-state.model';
import { RiskDecisionEvent } from '../../domain/events/risk-decision.event';
import { EvaluationContext } from '../../interfaces/risk-evaluator.interface';
import { AlertEngineService } from '@modules/alerts/application/services/alert-engine.service';
import { AlertLevel } from '@modules/alerts/domain/alert-level.enum';
import { AlertCategory } from '@modules/alerts/domain/alert-category.enum';
import { AlertCondition } from '@modules/alerts/domain/alert-condition.enum';
import { RiskStateService, RiskMetrics } from './risk-state.service';
import { EmergencyProtectionService } from './emergency-protection.service';
import { TradeValidatorService } from './trade-validator.service';
import { PortfolioLimitsService } from './portfolio-limits.service';
import { DailyLimitsService } from './daily-limits.service';
import { DynamicRiskReducerService } from './dynamic-risk-reducer.service';
import { PositionSizingService } from './position-sizing.service';

@Injectable()
export class RiskEngineService implements OnModuleInit {
  private readonly context = RiskEngineService.name;
  private readonly cfg: RiskConfig;

  constructor(
    configService: ConfigService,
    private readonly logger: AppLoggerService,
    @Inject(INFRASTRUCTURE_TOKENS.EVENT_BUS) private readonly eventBus: EventBusProvider,
    private readonly state: RiskStateService,
    private readonly emergency: EmergencyProtectionService,
    private readonly validator: TradeValidatorService,
    private readonly portfolioLimits: PortfolioLimitsService,
    private readonly dailyLimits: DailyLimitsService,
    private readonly dynamicReducer: DynamicRiskReducerService,
    private readonly positionSizing: PositionSizingService,
    private readonly alertEngine: AlertEngineService,
  ) {
    this.cfg = configService.get<RiskConfig>('risk')!;
  }

  onModuleInit(): void {
    if (!this.cfg.enabled) {
      this.logger.warn(
        'Risk Engine is DISABLED — all signals will be approved without checks',
        this.context,
      );
      return;
    }

    this.eventBus.subscribe<StrategySignalEvent>('StrategySignal', async (event) => {
      await this.evaluate(event.signal);
    });

    this.state.initEquity(this.cfg.defaultEquityUsd);
    this.logger.log(
      `Risk Engine initialized (equity: $${this.cfg.defaultEquityUsd.toLocaleString()})`,
      this.context,
    );
  }

  async evaluate(signal: Signal): Promise<RiskDecisionModel> {
    const start = Date.now();
    const portfolio = this.buildPortfolioSnapshot();

    const ctx: EvaluationContext = {
      signal,
      portfolio,
      currentAtr: this.extractAtr(signal),
      currentVolatility: this.extractVolatility(signal),
    };

    let decision: RiskDecisionModel;

    if (!this.cfg.enabled) {
      const sizing = this.positionSizing.calculate({
        equity: portfolio.equity,
        availableBalance: portfolio.availableBalance,
      });
      decision = {
        decisionId: randomUUID(),
        signal,
        decision: RiskDecision.APPROVE,
        violations: [],
        recommendedSize: null,
        recommendedSizeUsd: sizing.sizeUsd,
        sizingMethod: sizing.method,
        sizeReductionFactor: 1.0,
        reason: 'Risk engine disabled',
        evaluatedAt: Date.now(),
        durationMs: Date.now() - start,
      };
    } else if (signal.direction === SignalDirection.HOLD) {
      decision = {
        decisionId: randomUUID(),
        signal,
        decision: RiskDecision.APPROVE,
        violations: [],
        recommendedSize: null,
        recommendedSizeUsd: null,
        sizingMethod: null,
        sizeReductionFactor: 1.0,
        reason: 'HOLD signal — no position action required',
        evaluatedAt: Date.now(),
        durationMs: Date.now() - start,
      };
    } else {
      decision = this.runPipeline(ctx, start);
    }

    await this.publishDecision(decision);
    this.logDecision(decision);
    return decision;
  }

  getMetrics(): RiskMetrics {
    return this.state.getMetrics();
  }

  triggerKillSwitch(): void {
    this.state.triggerKillSwitch();
    this.logger.warn('KILL SWITCH TRIGGERED — all trading blocked', this.context);
  }

  pauseTrading(): void {
    this.state.pauseTrading();
    this.logger.warn('Trading PAUSED', this.context);
  }

  lockExposure(): void {
    this.state.lockExposure();
    this.logger.warn('Exposure LOCKED — no new directional positions', this.context);
  }

  resume(): void {
    this.state.resume();
    this.logger.log('Trading RESUMED', this.context);
  }

  resetKillSwitch(): void {
    this.state.resetKillSwitch();
    this.logger.log('Kill switch RESET', this.context);
  }

  recordTrade(pnl: number): void {
    this.state.recordTrade(pnl);
  }

  recordEquity(equity: number): void {
    this.state.recordEquity(equity);
  }

  getTotalTrades(): number {
    return this.state.getMetrics().totalTrades;
  }

  seedLifetimeStats(opts: {
    totalWins: number;
    totalLosses: number;
    totalWinPnl: number;
    totalLossPnl: number;
  }): void {
    this.state.seedLifetimeStats(opts);
  }

  private runPipeline(ctx: EvaluationContext, start: number): RiskDecisionModel {
    const { signal } = ctx;

    const emergency = this.emergency.check(ctx);
    if (!emergency.passed) {
      return this.buildDecision(
        signal,
        RiskDecision.BLOCK,
        emergency.violations,
        1.0,
        null,
        null,
        emergency.reason ?? '',
        start,
      );
    }

    const validation = this.validator.check(ctx);
    if (!validation.passed) {
      if (validation.violations.length === 0) {
        return this.buildDecision(
          signal,
          RiskDecision.APPROVE,
          [],
          1.0,
          null,
          null,
          validation.reason ?? '',
          start,
        );
      }
      return this.buildDecision(
        signal,
        RiskDecision.REJECT,
        validation.violations,
        1.0,
        null,
        null,
        validation.reason ?? '',
        start,
      );
    }

    const portfolio = this.portfolioLimits.check(ctx);
    if (!portfolio.passed) {
      return this.buildDecision(
        signal,
        RiskDecision.REJECT,
        portfolio.violations,
        1.0,
        null,
        null,
        portfolio.reason ?? '',
        start,
      );
    }

    const daily = this.dailyLimits.check(ctx);
    if (!daily.passed) {
      return this.buildDecision(
        signal,
        RiskDecision.REJECT,
        daily.violations,
        1.0,
        null,
        null,
        daily.reason ?? '',
        start,
      );
    }

    const reduction = this.dynamicReducer.evaluate(ctx);
    const sizing = this.positionSizing.calculate({
      equity: ctx.portfolio.equity,
      availableBalance: ctx.portfolio.availableBalance,
      currentAtr: ctx.currentAtr,
      currentVolatility: ctx.currentVolatility,
    });

    const adjustedSizeUsd = sizing.sizeUsd * reduction.factor;

    if (reduction.violations.length > 0) {
      const outcomeDecision = reduction.factor < 1.0 ? RiskDecision.REDUCE : RiskDecision.APPROVE;
      return this.buildDecision(
        signal,
        outcomeDecision,
        reduction.violations,
        reduction.factor,
        adjustedSizeUsd,
        sizing.method,
        `Size reduced to ${(reduction.factor * 100).toFixed(0)}% of calculated`,
        start,
      );
    }

    return this.buildDecision(
      signal,
      RiskDecision.APPROVE,
      [],
      1.0,
      adjustedSizeUsd,
      sizing.method,
      'All checks passed',
      start,
    );
  }

  private buildDecision(
    signal: Signal,
    decision: RiskDecision,
    violations: RiskViolation[],
    sizeReductionFactor: number,
    sizeUsd: number | null,
    sizingMethod: import('../../domain/enums/sizing-method.enum').SizingMethod | null,
    reason: string,
    start: number,
  ): RiskDecisionModel {
    return {
      decisionId: randomUUID(),
      signal,
      decision,
      violations,
      recommendedSize: null,
      recommendedSizeUsd: sizeUsd,
      sizingMethod,
      sizeReductionFactor,
      reason,
      evaluatedAt: Date.now(),
      durationMs: Date.now() - start,
    };
  }

  private buildPortfolioSnapshot(): PortfolioSnapshot {
    const metrics = this.state.getMetrics();
    const equity = metrics.currentEquity > 0 ? metrics.currentEquity : this.cfg.defaultEquityUsd;
    return {
      equity,
      availableBalance: equity,
      totalExposure: 0,
      currentLeverage: 1,
      openPositions: [],
      unrealizedPnl: 0,
      snapshotAt: Date.now(),
    };
  }

  private extractAtr(signal: Signal): number | undefined {
    const atr = signal.metadata['atr'];
    return typeof atr === 'number' ? atr : undefined;
  }

  private extractVolatility(signal: Signal): number | undefined {
    const vol = signal.metadata['volatility'];
    return typeof vol === 'number' ? vol : undefined;
  }

  private async publishDecision(decision: RiskDecisionModel): Promise<void> {
    const result = await this.eventBus.publish(new RiskDecisionEvent(decision));
    if (result.isErr()) {
      this.logger.error(
        `Failed to publish RiskDecisionEvent: ${result.error.message}`,
        undefined,
        this.context,
      );
    }
  }

  private logDecision(decision: RiskDecisionModel): void {
    const { signal, decision: outcome, violations, reason, durationMs } = decision;
    const base = `[${outcome}] signal=${signal.signalId} strategy=${signal.strategyId} symbol=${signal.symbol} dir=${signal.direction} (${durationMs}ms)`;

    if (outcome === RiskDecision.APPROVE) {
      this.logger.log(
        `${base} sizeUsd=$${decision.recommendedSizeUsd?.toFixed(2) ?? 'n/a'}`,
        this.context,
      );
    } else if (outcome === RiskDecision.REDUCE || outcome === RiskDecision.MODIFY) {
      this.logger.warn(
        `${base} factor=${decision.sizeReductionFactor.toFixed(2)} reason="${reason}"`,
        this.context,
      );
    } else {
      this.logger.warn(
        `${base} violations=[${violations.join(',')}] reason="${reason}"`,
        this.context,
      );

      // Fire Discord alerts for critical risk events (fire-and-forget)
      if (outcome === RiskDecision.BLOCK) {
        void this.alertEngine.raise({
          level: AlertLevel.CRITICAL,
          category: AlertCategory.RISK,
          condition: AlertCondition.KILL_SWITCH_ACTIVATED,
          title: 'Trading Blocked — Emergency Protection',
          message: `All signals blocked: ${reason} [strategy=${signal.strategyId} symbol=${signal.symbol}]`,
          source: this.context,
          context: { strategyId: signal.strategyId, symbol: String(signal.symbol), violations },
        });
      } else if (outcome === RiskDecision.REJECT) {
        if (violations.includes(RiskViolation.MAX_DAILY_LOSS_EXCEEDED)) {
          void this.alertEngine.raise({
            level: AlertLevel.WARNING,
            category: AlertCategory.RISK,
            condition: AlertCondition.DAILY_LOSS_LIMIT,
            title: 'Daily Loss Limit Reached',
            message: `Signal rejected — daily loss limit exceeded. ${reason}`,
            source: this.context,
            context: { strategyId: signal.strategyId, symbol: String(signal.symbol), ...this.state.getMetrics() },
          });
        } else if (violations.includes(RiskViolation.MAX_DRAWDOWN_EXCEEDED)) {
          void this.alertEngine.raise({
            level: AlertLevel.WARNING,
            category: AlertCategory.RISK,
            condition: AlertCondition.MAX_DRAWDOWN_EXCEEDED,
            title: 'Max Drawdown Exceeded',
            message: `Signal rejected — drawdown limit breached. ${reason}`,
            source: this.context,
            context: { strategyId: signal.strategyId, symbol: String(signal.symbol), ...this.state.getMetrics() },
          });
        }
      }
    }
  }
}
