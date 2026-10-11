/**
 * SdkSignalDirection is the complete set of actionable signal types.
 *
 * Strategies emit exactly one direction per signal. The platform risk engine
 * and execution engine interpret the direction to route the appropriate order.
 *
 * BUY     — open a long position, or increase an existing long
 * SELL    — open a short position, or increase an existing short
 * EXIT    — close any open position in this symbol (direction-agnostic)
 * HOLD    — no-op signal; useful for emitting confidence metadata while staying in position
 * REDUCE  — partially close an open position without fully exiting
 * REVERSE — exit the current position then open the opposite side
 *
 * Strategies MUST NOT emit BUY on a symbol they are already long without the
 * platform's position-awareness logic in effect. The risk engine enforces this.
 */
export enum SdkSignalDirection {
  BUY     = 'BUY',
  SELL    = 'SELL',
  EXIT    = 'EXIT',
  HOLD    = 'HOLD',
  REDUCE  = 'REDUCE',
  REVERSE = 'REVERSE',
}

/**
 * SdkSignal is the output of generateSignal().
 *
 * Strategies never submit orders — they emit signals. The platform's risk engine
 * validates each signal against current limits, and the execution engine routes
 * approved signals to the exchange as orders.
 *
 * Contract:
 *   - confidence MUST be in [0.0, 1.0]
 *   - reason MUST be a concise, human-readable explanation (it is logged and audited)
 *   - metadata MUST be JSON-serializable (no circular references, no functions)
 *   - symbol MUST be in normalized form (BASE/QUOTE or BASE/QUOTE:SETTLEMENT)
 *
 * A signal with confidence 0.0 MAY be filtered by the risk engine.
 * A signal with confidence 1.0 does not bypass risk checks — it is still validated.
 */
export interface SdkSignal {
  readonly symbol: string;
  readonly direction: SdkSignalDirection;
  readonly confidence: number;
  readonly reason: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}
