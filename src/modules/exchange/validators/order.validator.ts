import { Injectable } from '@nestjs/common';
import { Result, ok, err } from '@common/result';
import { NumberUtils } from '@shared/utils/number.utils';
import { SubmitOrderRequest } from '../models/trading.models';
import { SymbolInfo } from '../models/exchange.models';
import { OrderType, TimeInForce } from '../enums/order.enums';
import { ExchangeId } from '../enums/exchange.enums';
import {
  ExchangeInvalidRequestError,
  ExchangeUnsupportedOperationError,
} from '../errors/exchange.error';

type ValidationError = ExchangeInvalidRequestError | ExchangeUnsupportedOperationError;

/**
 * OrderValidator enforces exchange trading rules before an order reaches
 * the exchange's API.
 *
 * Validating before submission:
 *  - Prevents rejected orders that would consume rate limit weight
 *  - Provides clearer error messages than raw exchange rejection responses
 *  - Protects against inadvertent precision violations that cause silent fills
 *    at unexpected prices
 *
 * Validation is performed against SymbolInfo fetched from the exchange.
 * SymbolInfo must be current — stale rules may pass validation but fail
 * at the exchange (e.g. after a symbol delisting or precision change).
 *
 * checkPrecision: rounds the submitted price/quantity to the exchange's
 * allowed decimal places and returns an error if the original differs,
 * indicating the caller should round before submitting.
 */
@Injectable()
export class OrderValidator {
  validate(
    request: SubmitOrderRequest,
    symbolInfo: SymbolInfo,
    exchangeId: ExchangeId,
  ): Result<SubmitOrderRequest, ValidationError> {
    const checks: Array<() => Result<void, ValidationError>> = [
      (): Result<void, ValidationError> => this.validateSymbolActive(symbolInfo, exchangeId),
      (): Result<void, ValidationError> => this.validateOrderType(request, symbolInfo, exchangeId),
      (): Result<void, ValidationError> => this.validateQuantity(request, symbolInfo, exchangeId),
      (): Result<void, ValidationError> => this.validatePrice(request, symbolInfo, exchangeId),
      (): Result<void, ValidationError> => this.validateNotional(request, symbolInfo, exchangeId),
      (): Result<void, ValidationError> =>
        this.validateTimeInForce(request, symbolInfo, exchangeId),
    ];

    for (const check of checks) {
      const result = check();
      if (result.isErr()) return err(result.error);
    }

    return ok(request);
  }

  private validateSymbolActive(
    symbolInfo: SymbolInfo,
    exchangeId: ExchangeId,
  ): Result<void, ValidationError> {
    if (!symbolInfo.isActive) {
      return err(
        new ExchangeInvalidRequestError(exchangeId, `Symbol "${symbolInfo.symbol}" is not active`, {
          symbol: symbolInfo.symbol,
        }),
      );
    }
    return ok(undefined);
  }

  private validateOrderType(
    request: SubmitOrderRequest,
    symbolInfo: SymbolInfo,
    exchangeId: ExchangeId,
  ): Result<void, ValidationError> {
    const { type } = request;

    if (type === OrderType.LIMIT && !symbolInfo.allowsLimitOrder) {
      return err(new ExchangeUnsupportedOperationError(exchangeId, 'LIMIT orders for this symbol'));
    }
    if (type === OrderType.MARKET && !symbolInfo.allowsMarketOrder) {
      return err(
        new ExchangeUnsupportedOperationError(exchangeId, 'MARKET orders for this symbol'),
      );
    }
    if ((type === OrderType.STOP || type === OrderType.STOP_LIMIT) && !symbolInfo.allowsStopOrder) {
      return err(
        new ExchangeUnsupportedOperationError(exchangeId, `${type} orders for this symbol`),
      );
    }

    return ok(undefined);
  }

  private validateQuantity(
    request: SubmitOrderRequest,
    symbolInfo: SymbolInfo,
    exchangeId: ExchangeId,
  ): Result<void, ValidationError> {
    const { quantity } = request;

    if (!NumberUtils.isValidQuantity(quantity)) {
      return err(
        new ExchangeInvalidRequestError(exchangeId, 'Quantity must be a positive finite number'),
      );
    }

    if (quantity < symbolInfo.minQuantity) {
      return err(
        new ExchangeInvalidRequestError(
          exchangeId,
          `Quantity ${quantity} is below minimum ${symbolInfo.minQuantity}`,
          { quantity, minQuantity: symbolInfo.minQuantity },
        ),
      );
    }

    if (quantity > symbolInfo.maxQuantity) {
      return err(
        new ExchangeInvalidRequestError(
          exchangeId,
          `Quantity ${quantity} exceeds maximum ${symbolInfo.maxQuantity}`,
          { quantity, maxQuantity: symbolInfo.maxQuantity },
        ),
      );
    }

    const rounded = NumberUtils.floor(quantity, symbolInfo.quantityPrecision);
    if (!NumberUtils.approximately(rounded, quantity)) {
      return err(
        new ExchangeInvalidRequestError(
          exchangeId,
          `Quantity ${quantity} has too many decimal places — max ${symbolInfo.quantityPrecision} decimals (stepSize: ${symbolInfo.stepSize})`,
          {
            quantity,
            stepSize: symbolInfo.stepSize,
            quantityPrecision: symbolInfo.quantityPrecision,
          },
        ),
      );
    }

    return ok(undefined);
  }

  private validatePrice(
    request: SubmitOrderRequest,
    symbolInfo: SymbolInfo,
    exchangeId: ExchangeId,
  ): Result<void, ValidationError> {
    const { type, price } = request;

    if (type === OrderType.MARKET) return ok(undefined);

    if (price === undefined) {
      return err(
        new ExchangeInvalidRequestError(exchangeId, `Price is required for ${type} orders`),
      );
    }

    if (!NumberUtils.isValidPrice(price)) {
      return err(
        new ExchangeInvalidRequestError(exchangeId, 'Price must be a positive finite number'),
      );
    }

    if (symbolInfo.minPrice > 0 && price < symbolInfo.minPrice) {
      return err(
        new ExchangeInvalidRequestError(
          exchangeId,
          `Price ${price} is below minimum ${symbolInfo.minPrice}`,
        ),
      );
    }

    if (symbolInfo.maxPrice > 0 && price > symbolInfo.maxPrice) {
      return err(
        new ExchangeInvalidRequestError(
          exchangeId,
          `Price ${price} exceeds maximum ${symbolInfo.maxPrice}`,
        ),
      );
    }

    const rounded = NumberUtils.round(price, symbolInfo.pricePrecision);
    if (!NumberUtils.approximately(rounded, price)) {
      return err(
        new ExchangeInvalidRequestError(
          exchangeId,
          `Price ${price} has too many decimal places — max ${symbolInfo.pricePrecision} decimals (tickSize: ${symbolInfo.tickSize})`,
          { price, tickSize: symbolInfo.tickSize, pricePrecision: symbolInfo.pricePrecision },
        ),
      );
    }

    return ok(undefined);
  }

  private validateNotional(
    request: SubmitOrderRequest,
    symbolInfo: SymbolInfo,
    exchangeId: ExchangeId,
  ): Result<void, ValidationError> {
    if (request.type === OrderType.MARKET || !request.price) return ok(undefined);

    const notional = request.quantity * request.price;

    if (notional < symbolInfo.minNotional) {
      return err(
        new ExchangeInvalidRequestError(
          exchangeId,
          `Order notional ${notional} is below minimum ${symbolInfo.minNotional}`,
          { notional, minNotional: symbolInfo.minNotional },
        ),
      );
    }

    if (symbolInfo.maxNotional !== undefined && notional > symbolInfo.maxNotional) {
      return err(
        new ExchangeInvalidRequestError(
          exchangeId,
          `Order notional ${notional} exceeds maximum ${symbolInfo.maxNotional}`,
          { notional, maxNotional: symbolInfo.maxNotional },
        ),
      );
    }

    return ok(undefined);
  }

  private validateTimeInForce(
    request: SubmitOrderRequest,
    symbolInfo: SymbolInfo,
    exchangeId: ExchangeId,
  ): Result<void, ValidationError> {
    if (request.timeInForce === TimeInForce.POST_ONLY && !symbolInfo.allowsPostOnly) {
      return err(
        new ExchangeUnsupportedOperationError(
          exchangeId,
          'POST_ONLY time-in-force for this symbol',
        ),
      );
    }
    return ok(undefined);
  }
}
