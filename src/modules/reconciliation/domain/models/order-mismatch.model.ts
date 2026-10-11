import { OrderMismatchType } from '../enums/mismatch-type.enum';
import { RecoveryAction } from '../enums/recovery-action.enum';

export interface InternalOrderSnapshot {
  readonly clientOrderId: string;
  readonly exchangeOrderId: string | undefined;
  readonly symbol: string;
  readonly side: string;
  readonly state: string;
  readonly requestedQuantity: number;
  readonly executedQuantity: number;
}

export interface ExchangeOrderSnapshot {
  readonly exchangeOrderId: string;
  readonly clientOrderId: string | undefined;
  readonly symbol: string;
  readonly side: string;
  readonly status: string;
  readonly originalQuantity: number;
  readonly executedQuantity: number;
}

export interface OrderMismatch {
  readonly clientOrderId: string | undefined;
  readonly exchangeOrderId: string | undefined;
  readonly symbol: string;
  readonly type: OrderMismatchType;
  readonly internal: InternalOrderSnapshot | null;
  readonly exchange: ExchangeOrderSnapshot | null;
  readonly recoveryAction: RecoveryAction;
  readonly detectedAt: number;
}
