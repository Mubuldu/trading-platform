import { PositionMismatchType } from '../enums/mismatch-type.enum';
import { RecoveryAction } from '../enums/recovery-action.enum';

export interface InternalPositionSnapshot {
  readonly symbol: string;
  readonly direction: string;
  readonly quantity: number;
  readonly averageEntryPrice: number;
  readonly unrealizedPnl: number;
  readonly realizedPnl: number;
}

export interface ExchangePositionSnapshot {
  readonly symbol: string;
  readonly positionSide: string;
  readonly quantity: number;
  readonly entryPrice: number;
  readonly markPrice: number | undefined;
  readonly unrealizedPnl: number;
  readonly leverage: number;
  readonly marginMode: string;
}

export interface PositionMismatch {
  readonly symbol: string;
  readonly type: PositionMismatchType;
  readonly internal: InternalPositionSnapshot | null;
  readonly exchange: ExchangePositionSnapshot | null;
  readonly internalValue: number | string | null;
  readonly exchangeValue: number | string | null;
  readonly diffPct: number | null;
  readonly recoveryAction: RecoveryAction;
  readonly detectedAt: number;
}
