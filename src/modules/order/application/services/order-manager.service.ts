import { Injectable, Inject, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { StreamConsumerService } from '@infrastructure/redis/streams/stream-consumer.service';
import { StreamPublisherService } from '@infrastructure/redis/streams/stream-publisher.service';
import { ConsumerManagerService } from '@infrastructure/redis/streams/consumer-manager.service';
import { STREAM_NAMES } from '@infrastructure/redis/streams/stream-names.constants';
import { ConsumedMessage } from '@infrastructure/redis/streams/stream-event.interface';
import { IOrderRepository } from '@infrastructure/database/repository/order.repository';
import { DATABASE_TOKENS } from '@infrastructure/database/database.tokens';
import { OrderConfig } from '@config/order.config';
import { ExecutionReportModel } from '@modules/execution/domain/models/execution-report.model';
import { OrderModel, createNewOrder } from '../../domain/models/order.model';
import { OrderState, isTerminalState } from '../../domain/enums/order-state.enum';
import { OrderStateMachineService } from './order-state-machine.service';
import { OrderCacheService } from './order-cache.service';
import { OrderValidatorService } from './order-validator.service';
import { OrderTimeoutService } from './order-timeout.service';
import { OrderMetricsService, OrderMetricsSnapshot } from './order-metrics.service';

@Injectable()
export class OrderManagerService implements OnModuleInit, OnModuleDestroy {
  private readonly context = OrderManagerService.name;
  private readonly cfg: OrderConfig;
  private timeoutTimer?: ReturnType<typeof setInterval>;

  constructor(
    configService: ConfigService,
    private readonly logger: AppLoggerService,
    private readonly consumer: StreamConsumerService,
    private readonly consumerManager: ConsumerManagerService,
    private readonly publisher: StreamPublisherService,
    @Inject(DATABASE_TOKENS.ORDER_REPOSITORY)
    private readonly orderRepo: IOrderRepository,
    private readonly stateMachine: OrderStateMachineService,
    private readonly cache: OrderCacheService,
    private readonly validator: OrderValidatorService,
    private readonly timeoutService: OrderTimeoutService,
    readonly metrics: OrderMetricsService,
  ) {
    this.cfg = configService.get<OrderConfig>('order')!;
  }

  async onModuleInit(): Promise<void> {
    if (!this.cfg.enabled) {
      this.logger.warn('Order Manager is DISABLED — orders will not be tracked', this.context);
      return;
    }

    await this.recoverOpenOrders();

    await this.consumerManager.registerGroup({
      streamName: STREAM_NAMES.EXECUTION_REPORT,
      groupName: this.cfg.consumerGroup,
      startId: '0',
    });

    this.consumer.subscribe(STREAM_NAMES.EXECUTION_REPORT, this.cfg.consumerGroup, (msg) =>
      this.handleExecutionReport(msg),
    );

    this.timeoutTimer = setInterval(() => {
      void this.runTimeoutCheck();
    }, this.cfg.timeoutCheckIntervalMs);

    this.logger.log(
      `Order Manager initialized — consuming ${STREAM_NAMES.EXECUTION_REPORT} as group "${this.cfg.consumerGroup}"`,
      this.context,
    );
  }

  onModuleDestroy(): void {
    if (this.timeoutTimer) {
      clearInterval(this.timeoutTimer);
    }
  }

  private async handleExecutionReport(msg: ConsumedMessage): Promise<void> {
    const report = msg.event.payload as unknown as ExecutionReportModel;

    const dupResult = await this.validator.checkDuplicateReport(report);
    if (dupResult.isErr()) {
      this.logger.debug(
        `Duplicate report skipped: reportId=${report.reportId} clientOrderId=${report.clientOrderId}`,
        this.context,
      );
      return;
    }

    const order = await this.loadOrCreate(report);

    if (this.validator.isAlreadySeen(order, report.reportId)) {
      this.logger.debug(
        `Report already applied to order: reportId=${report.reportId}`,
        this.context,
      );
      return;
    }

    const transitionResult = this.stateMachine.apply(order, report);
    if (transitionResult.isErr()) {
      this.logger.warn(
        `State machine rejected report: ${transitionResult.error.message} (reportId=${report.reportId})`,
        this.context,
      );
      return;
    }

    const transition = transitionResult.value;

    await this.cache.markReportSeen(report.reportId);
    await this.persistOrder(order);
    await this.publishOrderUpdate(order, report);
    this.recordMetrics(order, transition.previousState);

    if (transition.isTerminal) {
      await this.cache.remove(order.clientOrderId);
      this.logger.log(
        `Order terminal: ${order.clientOrderId} → ${order.state} | sym=${order.symbol} ` +
          `execQty=${order.executedQuantity}/${order.requestedQuantity} avgPx=${order.averagePrice}`,
        this.context,
      );
    } else {
      this.logger.log(
        `Order update [${transition.previousState} → ${transition.nextState}]: ` +
          `${order.clientOrderId} ${order.side} ${order.requestedQuantity} ${order.symbol}`,
        this.context,
      );
    }
  }

  private async loadOrCreate(report: ExecutionReportModel): Promise<OrderModel> {
    const cached = await this.cache.load(report.clientOrderId);
    if (cached) return cached;

    const dbResult = await this.orderRepo.findByClientOrderId(report.clientOrderId);
    if (dbResult.isOk() && dbResult.value) {
      const restored = this.fromDbRow(dbResult.value);
      if (!isTerminalState(restored.state as OrderState)) {
        await this.cache.save(restored);
      }
      return restored;
    }

    const order = createNewOrder({
      clientOrderId: report.clientOrderId,
      correlationId: report.requestId,
      executionRequestId: report.requestId,
      riskDecisionId: report.decisionId,
      strategyId: report.strategyId,
      exchangeId: report.exchangeId,
      accountId: this.cfg.defaultAccountId,
      symbol: report.symbol,
      side: report.side,
      orderType: report.orderType,
      requestedQuantity: report.requestedQuantity,
    });

    this.metrics.recordCreated();
    return order;
  }

  private async persistOrder(order: OrderModel): Promise<void> {
    await this.cache.save(order);

    try {
      const existing = await this.orderRepo.findByClientOrderId(order.clientOrderId);

      if (existing.isOk() && existing.value) {
        await this.orderRepo.updateOptimistic(existing.value.id, existing.value.version, {
          exchange_order_id: order.exchangeOrderId ?? existing.value.exchange_order_id,
          status: order.state,
          executed_quantity: String(order.executedQuantity),
          remaining_quantity: String(order.remainingQuantity),
          average_price: String(order.averagePrice),
          updated_at: new Date(order.updatedAt),
        });
      } else {
        await this.orderRepo.save({
          account_id: order.accountId,
          exchange_id: order.exchangeId,
          exchange_order_id: order.exchangeOrderId ?? order.clientOrderId,
          client_order_id: order.clientOrderId,
          symbol: order.symbol,
          side: order.side,
          type: order.orderType,
          status: order.state,
          time_in_force: 'GTC',
          position_side: null,
          original_quantity: String(order.requestedQuantity),
          executed_quantity: String(order.executedQuantity),
          remaining_quantity: String(order.remainingQuantity),
          cumulative_quote_quantity: '0',
          price: '0',
          average_price: String(order.averagePrice),
          stop_price: null,
          trailing_delta: null,
          reduce_only: false,
          post_only: false,
          is_iceberg: false,
          iceberg_quantity: null,
          fee_amount: null,
          fee_asset: null,
        });
      }
    } catch (e) {
      this.logger.error(
        `DB persist failed for order ${order.clientOrderId}: ${(e as Error).message}`,
        undefined,
        this.context,
      );
    }
  }

  private async publishOrderUpdate(order: OrderModel, report: ExecutionReportModel): Promise<void> {
    try {
      await this.publisher.publish(STREAM_NAMES.ORDER_UPDATE, {
        correlationId: order.correlationId,
        eventType: 'OrderUpdate',
        exchange: order.exchangeId,
        symbol: order.symbol,
        timestamp: order.updatedAt,
        producer: this.context,
        payload: {
          orderId: order.orderId,
          clientOrderId: order.clientOrderId,
          exchangeOrderId: order.exchangeOrderId,
          correlationId: order.correlationId,
          strategyId: order.strategyId,
          symbol: order.symbol,
          side: order.side,
          orderType: order.orderType,
          state: order.state,
          requestedQuantity: order.requestedQuantity,
          executedQuantity: order.executedQuantity,
          remainingQuantity: order.remainingQuantity,
          averagePrice: order.averagePrice,
          reportType: report.reportType,
          submittedAt: order.submittedAt,
          acknowledgedAt: order.acknowledgedAt,
          firstFillAt: order.firstFillAt,
          filledAt: order.filledAt,
          closedAt: order.closedAt,
          updatedAt: order.updatedAt,
          errorMessage: order.errorMessage,
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

  private recordMetrics(order: OrderModel, previousState: OrderState): void {
    switch (order.state) {
      case OrderState.CLOSED:
        if (previousState === OrderState.FILLED && order.submittedAt && order.filledAt) {
          this.metrics.recordFilled(order.filledAt - order.submittedAt);
        }
        break;
      case OrderState.CANCELLED:
        this.metrics.recordCancelled();
        break;
      case OrderState.REJECTED:
        this.metrics.recordRejected();
        break;
      case OrderState.FAILED:
        this.metrics.recordFailed();
        break;
    }
  }

  private async recoverOpenOrders(): Promise<void> {
    try {
      const result = await this.orderRepo.findOpenByAccount(this.cfg.defaultAccountId);
      if (result.isErr()) {
        this.logger.warn(`Failed to recover open orders: ${result.error.message}`, this.context);
        return;
      }

      let count = 0;
      for (const row of result.value) {
        const order = this.fromDbRow(row);
        if (!isTerminalState(order.state as OrderState)) {
          await this.cache.save(order);
          count++;
        }
      }

      if (count > 0) {
        this.logger.log(`Recovered ${count} open orders into cache`, this.context);
      }
    } catch (e) {
      this.logger.error(`Order recovery failed: ${(e as Error).message}`, undefined, this.context);
    }
  }

  private async runTimeoutCheck(): Promise<void> {
    try {
      await this.timeoutService.checkAll({
        pendingTimeoutMs: this.cfg.pendingTimeoutMs,
        ackTimeoutMs: this.cfg.ackTimeoutMs,
        fillTimeoutMs: this.cfg.fillTimeoutMs,
      });
    } catch (e) {
      this.logger.error(`Timeout check error: ${(e as Error).message}`, undefined, this.context);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private fromDbRow(row: any): OrderModel {
    return {
      orderId: row.client_order_id ?? row.id,
      clientOrderId: row.client_order_id ?? row.id,
      correlationId: row.client_order_id ?? row.id,
      executionRequestId: row.client_order_id ?? row.id,
      riskDecisionId: '',
      strategyId: '',
      exchangeId: row.exchange_id,
      accountId: row.account_id,
      symbol: row.symbol,
      side: row.side,
      orderType: row.type,
      exchangeOrderId: row.exchange_order_id,
      state: (row.status as OrderState) ?? OrderState.OPEN,
      requestedQuantity: parseFloat(row.original_quantity),
      executedQuantity: parseFloat(row.executed_quantity),
      remainingQuantity: parseFloat(row.remaining_quantity),
      averagePrice: parseFloat(row.average_price),
      executionAttempts: 1,
      reportIds: [],
      createdAt: new Date(row.created_at).getTime(),
      updatedAt: new Date(row.updated_at).getTime(),
      version: row.version,
    };
  }

  isEnabled(): boolean {
    return this.cfg.enabled;
  }

  async getActiveOrders(): Promise<OrderModel[]> {
    return this.cache.loadAll();
  }

  getMetrics(): OrderMetricsSnapshot {
    return this.metrics.snapshot();
  }
}
