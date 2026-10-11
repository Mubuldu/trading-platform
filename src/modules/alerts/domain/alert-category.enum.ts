/**
 * AlertCategory groups alerts by the subsystem they originate from.
 * Used for routing rules (e.g. Exchange alerts → on-call exchange team),
 * dashboard filtering, and report grouping.
 *
 * Never change the string values — they are stored in the database.
 */
export enum AlertCategory {
  EXCHANGE = 'Exchange',
  DATABASE = 'Database',
  REDIS = 'Redis',
  STRATEGY = 'Strategy',
  RISK = 'Risk',
  EXECUTION = 'Execution',
  PORTFOLIO = 'Portfolio',
  INFRASTRUCTURE = 'Infrastructure',
}
