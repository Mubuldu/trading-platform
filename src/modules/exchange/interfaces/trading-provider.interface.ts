import { Result } from '@common/result';
import { NormalizedSymbol } from '../models/common.model';
import {
  Order,
  SubmitOrderRequest,
  CancelOrderRequest,
  ModifyOrderRequest,
  BatchOrderResult,
} from '../models/trading.models';
import { ExchangeError } from '../errors/exchange.error';

/**
 * TradingProvider handles all order lifecycle operations.
 *
 * Every method returns a Result. Callers must handle the error branch —
 * especially InsufficientBalanceError and RateLimitError, which require
 * specific recovery strategies rather than generic retries.
 *
 * Batch methods (submitBatch, cancelBatch) are available only when
 * ExchangeCapabilities.supportsBatchOrders is true. Callers must check
 * before using them; if called on an unsupported exchange, the adapter
 * returns ExchangeUnsupportedOperationError.
 *
 * clientOrderId: always populate this in SubmitOrderRequest. It enables
 * idempotent order submission — if the network drops after sending but
 * before receiving a response, you can safely resubmit with the same
 * clientOrderId. The exchange will return the existing order instead of
 * creating a duplicate.
 */
export interface TradingProvider {
  submitOrder(request: SubmitOrderRequest): Promise<Result<Order, ExchangeError>>;
  cancelOrder(request: CancelOrderRequest): Promise<Result<Order, ExchangeError>>;
  cancelAllOrders(symbol?: NormalizedSymbol): Promise<Result<Order[], ExchangeError>>;
  modifyOrder(request: ModifyOrderRequest): Promise<Result<Order, ExchangeError>>;
  submitBatch(requests: SubmitOrderRequest[]): Promise<Result<BatchOrderResult, ExchangeError>>;
  cancelBatch(requests: CancelOrderRequest[]): Promise<Result<BatchOrderResult, ExchangeError>>;
}
