/**
 * AlertLevel defines the severity of an alert in ascending order.
 *
 * Escalation flows upward: INFO → WARNING → ERROR → CRITICAL → FATAL.
 * FATAL alerts demand immediate operator intervention — trading should be
 * suspended and the on-call pager fired.
 *
 * Never change the string values — they are stored in the database and
 * referenced by monitoring dashboards.
 */
export enum AlertLevel {
  INFO = 'INFO',
  WARNING = 'WARNING',
  ERROR = 'ERROR',
  CRITICAL = 'CRITICAL',
  FATAL = 'FATAL',
}

/** Ordered severity from lowest to highest (used for escalation). */
export const ALERT_LEVEL_ORDER: AlertLevel[] = [
  AlertLevel.INFO,
  AlertLevel.WARNING,
  AlertLevel.ERROR,
  AlertLevel.CRITICAL,
  AlertLevel.FATAL,
];

/**
 * Returns the next escalation level.
 * Returns the same level if already at FATAL.
 */
export function escalateLevel(level: AlertLevel): AlertLevel {
  const idx = ALERT_LEVEL_ORDER.indexOf(level);
  if (idx === -1 || idx === ALERT_LEVEL_ORDER.length - 1) return AlertLevel.FATAL;
  return ALERT_LEVEL_ORDER[idx + 1];
}

/**
 * Numeric severity score — useful for sorting and threshold comparison.
 */
export const ALERT_LEVEL_SEVERITY: Record<AlertLevel, number> = {
  [AlertLevel.INFO]: 1,
  [AlertLevel.WARNING]: 2,
  [AlertLevel.ERROR]: 3,
  [AlertLevel.CRITICAL]: 4,
  [AlertLevel.FATAL]: 5,
};
