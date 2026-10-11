import { Alert } from '../../domain/alert.entity';

/**
 * AlertChannel is the port for all external notification transports.
 *
 * Every channel implementation MUST:
 *  - Never throw — catch all errors internally and return false on failure
 *  - Complete within the configured timeout
 *  - Log failures at WARN level so the engine can carry on
 *
 * Channels are never called from the critical trading path. They run in a
 * fire-and-forget Promise chain launched by the dispatcher.
 */
export interface AlertChannel {
  /** Stable channel identifier (e.g. "email", "discord"). */
  readonly name: string;

  /** True when the channel has all required configuration to operate. */
  isConfigured(): boolean;

  /**
   * Send a notification for the given alert.
   * @returns true on success, false on any failure (already logged internally)
   */
  send(alert: Alert): Promise<boolean>;
}

/** ALERT_CHANNEL injection token for multi-provider injection. */
export const ALERT_CHANNEL = 'ALERT_CHANNEL';
