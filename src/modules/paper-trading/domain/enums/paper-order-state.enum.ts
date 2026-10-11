/**
 * PaperOrderState tracks the lifecycle of a simulated order.
 *
 * NEW        — registered, not yet filled (limit/stop waiting for price)
 * FILLED     — fully executed
 * PARTIALLY_FILLED — partially executed; remainder still pending
 * CANCELLED  — cancelled before fill
 * EXPIRED    — GTC order cancelled at session end
 */
export enum PaperOrderState {
  NEW = 'NEW',
  FILLED = 'FILLED',
  PARTIALLY_FILLED = 'PARTIALLY_FILLED',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
}
