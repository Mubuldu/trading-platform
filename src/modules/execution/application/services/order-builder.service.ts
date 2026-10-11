import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Result, ok, err } from '@common/result';
import { ExchangeAdapter } from '@modules/exchange/interfaces/exchange-adapter.interface';
import { OrderSide, OrderType, TimeInForce } from '@modules/exchange/enums/order.enums';
import { NormalizedSymbol } from '@modules/exchange/models/common.model';
import { SignalDirection } from '@modules/strategy/domain/enums/signal-direction.enum';
import { RiskDecisionModel } from '@modules/risk/domain/models/risk-decision.model';
import { ExchangeId } from '@modules/exchange/enums/exchange.enums';
import { ExecutionRequestModel } from '../../domain/models/execution-request.model';
import { OrderBuildError } from '../../domain/errors/execution.errors';

@Injectable()
export class OrderBuilderService {
  async build(
    decision: RiskDecisionModel,
    exchangeId: ExchangeId,
    adapter: ExchangeAdapter,
  ): Promise<Result<ExecutionRequestModel, OrderBuildError>> {
    const { signal, recommendedSizeUsd, decisionId } = decision;

    const side = this.resolveSide(signal.direction);
    if (!side) {
      return err(new OrderBuildError(`Cannot map direction "${signal.direction}" to OrderSide`));
    }

    const orderType = this.resolveOrderType(signal.metadata);
    const timeInForce = this.resolveTimeInForce(signal.metadata, orderType);
    const reduceOnly = signal.metadata['reduceOnly'] === true;
    const postOnly = signal.metadata['postOnly'] === true;
    const stopPrice = this.extractNumber(signal.metadata['stopPrice']);

    let price = this.extractNumber(signal.metadata['price']);
    let executionPrice: number;

    if (price && price > 0) {
      executionPrice = price;
    } else {
      const sym = NormalizedSymbol.unsafe(signal.symbol);
      const tickerResult = await adapter.getTicker(sym);
      if (tickerResult.isErr()) {
        return err(
          new OrderBuildError(
            `Failed to get ticker for ${signal.symbol}: ${tickerResult.error.message}`,
            tickerResult.error,
          ),
        );
      }
      executionPrice = tickerResult.value.lastPrice;
      if (orderType === OrderType.MARKET) {
        price = undefined;
      }
    }

    if (!executionPrice || executionPrice <= 0) {
      return err(new OrderBuildError(`Invalid execution price: ${executionPrice}`));
    }

    const rawQuantity = recommendedSizeUsd! / executionPrice;

    const sym = NormalizedSymbol.unsafe(signal.symbol);
    const symbolInfoResult = await adapter.getSymbolInfo(sym);
    let quantity = rawQuantity;
    if (symbolInfoResult.isOk()) {
      const info = symbolInfoResult.value;
      quantity = this.roundDown(rawQuantity, info.quantityPrecision);
      if (quantity < info.minQuantity) {
        return err(
          new OrderBuildError(
            `Computed quantity ${quantity} is below minQuantity ${info.minQuantity} for ${signal.symbol}`,
          ),
        );
      }
    }

    const clientOrderId = `${signal.strategyId}-${decisionId}-${Date.now()}`;

    return ok({
      requestId: randomUUID(),
      decisionId,
      strategyId: signal.strategyId,
      signalId: signal.signalId,
      exchangeId,
      symbol: signal.symbol,
      side,
      orderType,
      quantity,
      price: orderType !== OrderType.MARKET ? price : undefined,
      stopPrice,
      timeInForce,
      reduceOnly: reduceOnly || undefined,
      postOnly: postOnly || undefined,
      clientOrderId,
      correlationId: randomUUID(),
      createdAt: Date.now(),
    });
  }

  private resolveSide(direction: SignalDirection): OrderSide | undefined {
    switch (direction) {
      case SignalDirection.BUY:
        return OrderSide.BUY;
      case SignalDirection.SELL:
      case SignalDirection.EXIT:
      case SignalDirection.REDUCE:
      case SignalDirection.REVERSE:
        return OrderSide.SELL;
      default:
        return undefined;
    }
  }

  private resolveOrderType(metadata: Readonly<Record<string, unknown>>): OrderType {
    const typeStr = metadata['orderType'];
    if (typeof typeStr === 'string') {
      const upper = typeStr.toUpperCase();
      if (Object.values(OrderType).includes(upper as OrderType)) {
        return upper as OrderType;
      }
    }
    const hasPrice = this.extractNumber(metadata['price']) != null;
    return hasPrice ? OrderType.LIMIT : OrderType.MARKET;
  }

  private resolveTimeInForce(
    metadata: Readonly<Record<string, unknown>>,
    orderType: OrderType,
  ): TimeInForce | undefined {
    const tif = metadata['timeInForce'];
    if (typeof tif === 'string') {
      const upper = tif.toUpperCase();
      if (Object.values(TimeInForce).includes(upper as TimeInForce)) {
        return upper as TimeInForce;
      }
    }
    if (metadata['postOnly'] === true) return TimeInForce.POST_ONLY;
    if (metadata['ioc'] === true) return TimeInForce.IOC;
    if (metadata['fok'] === true) return TimeInForce.FOK;
    return orderType === OrderType.LIMIT ? TimeInForce.GTC : undefined;
  }

  private extractNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && isFinite(value) && value > 0) return value;
    if (typeof value === 'string') {
      const parsed = parseFloat(value);
      if (isFinite(parsed) && parsed > 0) return parsed;
    }
    return undefined;
  }

  private roundDown(value: number, decimals: number): number {
    const factor = Math.pow(10, decimals);
    return Math.floor(value * factor) / factor;
  }
}
