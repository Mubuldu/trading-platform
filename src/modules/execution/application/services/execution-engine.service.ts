import { Injectable, Inject, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { AppLoggerService } from '@core/logging/app-logger.service';
import {
  EventBusProvider,
  EventSubscription,
} from '@infrastructure/providers/event-bus/event-bus.interface';
import { INFRASTRUCTURE_TOKENS } from '@infrastructure/infrastructure.tokens';
import { StreamPublisherService } from '@infrastructure/redis/streams/stream-publisher.service';
import { STREAM_NAMES } from '@infrastructure/redis/streams/stream-names.constants';
import { RiskDecisionEvent } from '@modules/risk/domain/events/risk-decision.event';
import { RiskDecisionModel } from '@modules/risk/domain/models/risk-decision.model';
import { SignalDirection } from '@modules/strategy/domain/enums/signal-direction.enum';
import { ExecutionConfig } from '@config/execution.config';
import { ExchangeId } from '@modules/exchange/enums/exchange.enums';
import { OrderSide, OrderType } from '@modules/exchange/enums/order.enums';
import { NormalizedSymbol } from '@modules/exchange/models/common.model';
import { ExecutionRequestModel } from '../../domain/models/execution-request.model';
import { ExecutionReportModel } from '../../domain/models/execution-report.model';
import { ExecutionStatus } from '../../domain/enums/execution-status.enum';
import { ExecutionReportType } from '../../domain/enums/execution-report-type.enum';
import { LatencySample } from '../../domain/models/latency-sample.model';
import { ExecutionValidatorService } from './execution-validator.service';
import { OrderRouterService } from './order-router.service';
import { OrderBuilderService } from './order-builder.service';
import { RetryManagerService } from './retry-manager.service';
import { OrderTrackerService } from './order-tracker.service';
import { FillProcessorService } from './fill-processor.service';
import { LatencyMonitorService } from './latency-monitor.service';

@Injectable()
export class ExecutionEngineService implements OnModuleInit, OnModuleDestroy {
  private readonly context = ExecutionEngineService.name;
  private readonly cfg: ExecutionConfig;
  private riskDecisionSubscription: EventSubscription | null = null;

  constructor(
    configService: ConfigService,
    private readonly logger: AppLoggerService,
    @Inject(INFRASTRUCTURE_TOKENS.EVENT_BUS) private readonly eventBus: EventBusProvider,
    private readonly publisher: StreamPublisherService,
    private readonly validator: ExecutionValidatorService,
    private readonly router: OrderRouterService,
    private readonly builder: OrderBuilderService,
    private readonly retryManager: RetryManagerService,
    private readonly tracker: OrderTrackerService,
    private readonly fillProcessor: FillProcessorService,
    private readonly latencyMonitor: LatencyMonitorService,
  ) {
    this.cfg = configService.get<ExecutionConfig>('execution')!;
  }

  onModuleInit(): void {
    if (!this.cfg.enabled) {
      this.logger.warn(
        'Execution Engine is DISABLED — all risk decisions will be ignored',
        this.context,
      );
      return;
    }

    this.riskDecisionSubscription = this.eventBus.subscribe<RiskDecisionEvent>(
      'RiskDecision',
      async (event) => {
        await this.execute(event.riskDecision);
      },
    );

    this.logger.log(
      'Execution Engine initialized — listening for RiskDecision events',
      this.context,
    );
  }

  onModuleDestroy(): void {
    this.riskDecisionSubscription?.unsubscribe();
    this.riskDecisionSubscription = null;
  }

  async execute(decision: RiskDecisionModel): Promise<void> {
    const latency = this.latencyMonitor.start();

    // ── Step 1: Validate ─────────────────────────────────────────────────────
    const validationResult = this.validator.validate(decision);
    latency.markValidation();

    if (validationResult.isErr()) {
      this.logger.debug(
        `Skipping execution: ${validationResult.error.message} (decision=${decision.decisionId})`,
        this.context,
      );
      return;
    }

    // ── Step 2: Route to adapter ─────────────────────────────────────────────
    const orderType = this.peekOrderType(decision);
    const routeResult = this.router.route(decision.signal.exchange, orderType);
    latency.markRoute();

    if (routeResult.isErr()) {
      const sample = latency.sample();
      await this.publishFailureReport(
        decision,
        routeResult.error.message,
        ExecutionReportType.SUBMISSION_FAILED,
        sample,
      );
      this.logger.warn(
        `Routing failed for decision=${decision.decisionId}: ${routeResult.error.message}`,
        this.context,
      );
      return;
    }

    const adapter = routeResult.value;
    const exchangeId = adapter.getExchangeId();

    // ── Step 3: Build order ──────────────────────────────────────────────────
    const buildResult = await this.builder.build(decision, exchangeId, adapter);
    latency.markBuild();

    if (buildResult.isErr()) {
      const sample = latency.sample();
      await this.publishFailureReport(
        decision,
        buildResult.error.message,
        ExecutionReportType.SUBMISSION_FAILED,
        sample,
      );
      this.logger.warn(
        `Order build failed for decision=${decision.decisionId}: ${buildResult.error.message}`,
        this.context,
      );
      return;
    }

    const request = buildResult.value;
    this.tracker.start(request.requestId, request);
    this.tracker.markSubmitted(request.requestId);

    // ── Step 4: Submit with retries ──────────────────────────────────────────
    latency.markExchangeRequest();

    const submitResult = await this.retryManager.submit(
      adapter,
      {
        symbol: NormalizedSymbol.unsafe(request.symbol),
        side: request.side,
        type: request.orderType,
        quantity: request.quantity,
        price: request.price,
        stopPrice: request.stopPrice,
        timeInForce: request.timeInForce,
        clientOrderId: request.clientOrderId,
        reduceOnly: request.reduceOnly,
        postOnly: request.postOnly,
        correlationId: request.correlationId,
      },
      this.cfg.maxRetries,
    );

    latency.markExchangeResponse();

    if (submitResult.isErr()) {
      this.tracker.fail(request.requestId, submitResult.error.message);
      const sample = latency.sample();
      await this.publishFailureReport(
        decision,
        submitResult.error.message,
        ExecutionReportType.SUBMISSION_FAILED,
        sample,
        request,
        0,
      );
      this.logger.error(
        `Order submission failed for decision=${decision.decisionId}: ${submitResult.error.message}`,
        undefined,
        this.context,
      );
      return;
    }

    const { order, attempts } = submitResult.value;
    const retries = attempts - 1;

    // ── Step 5: Process fill ─────────────────────────────────────────────────
    const fill = this.fillProcessor.process(request, order);
    latency.markFillProcessing();

    this.tracker.update(request.requestId, order);

    // ── Step 6: Publish reports ──────────────────────────────────────────────
    const sample = latency.sample();

    const report: ExecutionReportModel = {
      reportId: randomUUID(),
      requestId: request.requestId,
      decisionId: decision.decisionId,
      strategyId: request.strategyId,
      exchangeId,
      symbol: request.symbol,
      side: request.side,
      orderType: request.orderType,
      reportType: fill.reportType,
      status: fill.status,
      exchangeOrderId: order.exchangeOrderId,
      clientOrderId: request.clientOrderId,
      requestedQuantity: request.quantity,
      executedQuantity: fill.executedQuantity,
      remainingQuantity: fill.remainingQuantity,
      averagePrice: fill.averagePrice,
      exchangeStatus: order.status,
      retries,
      latency: sample,
      generatedAt: Date.now(),
    };

    await Promise.allSettled([
      this.publishReport(report),
      this.publishAudit(report, decision),
      this.publishOrderUpdate(report),
    ]);

    this.logger.log(
      `[${fill.reportType}] decision=${decision.decisionId} order=${order.exchangeOrderId} ` +
        `qty=${fill.executedQuantity}/${request.quantity} price=${fill.averagePrice} ` +
        `retries=${retries} total=${sample.totalTimeMs}ms`,
      this.context,
    );
  }

  private async publishReport(report: ExecutionReportModel): Promise<void> {
    try {
      await this.publisher.publish(STREAM_NAMES.EXECUTION_REPORT, {
        correlationId: report.requestId,
        eventType: 'ExecutionReport',
        exchange: report.exchangeId,
        symbol: report.symbol,
        timestamp: report.generatedAt,
        producer: this.context,
        payload: report as unknown as Record<string, unknown>,
      });
    } catch (e) {
      this.logger.error(
        `Failed to publish execution report: ${(e as Error).message}`,
        undefined,
        this.context,
      );
    }
  }

  private async publishAudit(
    report: ExecutionReportModel,
    decision: RiskDecisionModel,
  ): Promise<void> {
    try {
      await this.publisher.publish(STREAM_NAMES.EXECUTION_AUDIT, {
        correlationId: report.requestId,
        eventType: 'ExecutionAudit',
        exchange: report.exchangeId,
        symbol: report.symbol,
        timestamp: report.generatedAt,
        producer: this.context,
        payload: {
          report: report as unknown as Record<string, unknown>,
          riskDecisionId: decision.decisionId,
          riskDecision: decision.decision,
          riskReason: decision.reason,
          sizeReductionFactor: decision.sizeReductionFactor,
          evaluatedAt: decision.evaluatedAt,
        },
      });
    } catch (e) {
      this.logger.error(
        `Failed to publish execution audit: ${(e as Error).message}`,
        undefined,
        this.context,
      );
    }
  }

  private async publishOrderUpdate(report: ExecutionReportModel): Promise<void> {
    try {
      await this.publisher.publish(STREAM_NAMES.ORDER_UPDATE, {
        correlationId: report.requestId,
        eventType: 'OrderUpdate',
        exchange: report.exchangeId,
        symbol: report.symbol,
        timestamp: report.generatedAt,
        producer: this.context,
        payload: {
          requestId: report.requestId,
          exchangeOrderId: report.exchangeOrderId,
          clientOrderId: report.clientOrderId,
          status: report.status,
          exchangeStatus: report.exchangeStatus,
          executedQuantity: report.executedQuantity,
          remainingQuantity: report.remainingQuantity,
          averagePrice: report.averagePrice,
        },
      });
    } catch (e) {
      this.logger.error(
        `Failed to publish order update: ${(e as Error).message}`,
        undefined,
        this.context,
      );
    }
  }

  private async publishFailureReport(
    decision: RiskDecisionModel,
    errorMessage: string,
    reportType: ExecutionReportType,
    latency: LatencySample,
    request?: ExecutionRequestModel,
    retries?: number,
  ): Promise<void> {
    const report: ExecutionReportModel = {
      reportId: randomUUID(),
      requestId: request?.requestId ?? randomUUID(),
      decisionId: decision.decisionId,
      strategyId: decision.signal.strategyId,
      // signal.exchange is a runtime-validated ExchangeId string — safe assertion.
      exchangeId: request?.exchangeId ?? (decision.signal.exchange as ExchangeId),
      symbol: decision.signal.symbol,
      // Map SignalDirection → OrderSide; use request.side when available.
      side: request?.side ?? this.directionToSide(decision.signal.direction),
      // For early failures (no order built yet) we report MARKET as the intended
      // type — it is the default when no explicit type is specified in metadata.
      orderType: request?.orderType ?? OrderType.MARKET,
      reportType,
      status: ExecutionStatus.FAILED,
      clientOrderId: request?.clientOrderId ?? '',
      requestedQuantity: request?.quantity ?? 0,
      executedQuantity: 0,
      remainingQuantity: request?.quantity ?? 0,
      averagePrice: 0,
      retries: retries ?? 0,
      latency,
      errorMessage,
      generatedAt: Date.now(),
    };

    await this.publishReport(report);
    await this.publishAudit(report, decision);
  }

  /**
   * Maps a SignalDirection to the closest OrderSide for failure reports.
   * BUY signals map to BUY; SELL / EXIT / REDUCE / REVERSE all map to SELL
   * (they all result in reducing or closing a long position).
   * HOLD is unreachable in practice — the risk engine filters it before
   * emitting a RiskDecision — but defaults to SELL defensively.
   */
  private directionToSide(direction: SignalDirection): OrderSide {
    return direction === SignalDirection.BUY ? OrderSide.BUY : OrderSide.SELL;
  }

  private peekOrderType(decision: RiskDecisionModel): OrderType {
    const typeStr = decision.signal.metadata['orderType'];
    if (typeof typeStr === 'string') {
      const upper = typeStr.toUpperCase();
      if (Object.values(OrderType).includes(upper as OrderType)) return upper as OrderType;
    }
    const hasPrice =
      typeof decision.signal.metadata['price'] === 'number' &&
      (decision.signal.metadata['price'] as number) > 0;
    return hasPrice ? OrderType.LIMIT : OrderType.MARKET;
  }
}
