export enum OrderState {
  // Normal lifecycle
  NEW = 'NEW',
  VALIDATED = 'VALIDATED',
  SUBMITTED = 'SUBMITTED',
  ACKNOWLEDGED = 'ACKNOWLEDGED',
  OPEN = 'OPEN',
  PARTIALLY_FILLED = 'PARTIALLY_FILLED',
  FILLED = 'FILLED',
  CLOSED = 'CLOSED',

  // Failure terminal states
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export const STATE_ORDINAL: Record<OrderState, number> = {
  [OrderState.NEW]: 0,
  [OrderState.VALIDATED]: 1,
  [OrderState.SUBMITTED]: 2,
  [OrderState.ACKNOWLEDGED]: 3,
  [OrderState.OPEN]: 4,
  [OrderState.PARTIALLY_FILLED]: 5,
  [OrderState.FILLED]: 6,
  [OrderState.CLOSED]: 7,
  [OrderState.REJECTED]: 8,
  [OrderState.EXPIRED]: 9,
  [OrderState.FAILED]: 10,
  [OrderState.CANCELLED]: 11,
};

export const TERMINAL_ORDER_STATES = new Set<OrderState>([
  OrderState.CLOSED,
  OrderState.REJECTED,
  OrderState.EXPIRED,
  OrderState.FAILED,
  OrderState.CANCELLED,
]);

export const ACTIVE_ORDER_STATES = new Set<OrderState>([
  OrderState.NEW,
  OrderState.VALIDATED,
  OrderState.SUBMITTED,
  OrderState.ACKNOWLEDGED,
  OrderState.OPEN,
  OrderState.PARTIALLY_FILLED,
  OrderState.FILLED,
]);

export function isTerminalState(state: OrderState): boolean {
  return TERMINAL_ORDER_STATES.has(state);
}

export function advancesState(from: OrderState, to: OrderState): boolean {
  return STATE_ORDINAL[to] > STATE_ORDINAL[from];
}
