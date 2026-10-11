import { SignalDirection } from '../domain/enums/signal-direction.enum';

export interface Signal {
  readonly signalId: string;
  readonly timestamp: number;
  readonly strategyId: string;
  readonly exchange: string;
  readonly symbol: string;
  readonly direction: SignalDirection;
  readonly confidence: number;
  readonly reason: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}
