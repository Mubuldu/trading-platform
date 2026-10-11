/**
 * Lifecycle states of a research experiment.
 *
 * Transitions:
 *   PENDING → RUNNING → COMPLETED | FAILED | CANCELLED
 *
 * A COMPLETED experiment may then enter the promotion pipeline.
 * FAILED and CANCELLED experiments may be retried (back to PENDING).
 */
export enum ExperimentStatus {
  /** Experiment is queued but not yet started. */
  PENDING = 'PENDING',

  /** Experiment is actively running (data loading, model training, evaluation). */
  RUNNING = 'RUNNING',

  /** Experiment finished successfully with results available. */
  COMPLETED = 'COMPLETED',

  /** Experiment encountered an unrecoverable error. */
  FAILED = 'FAILED',

  /** Experiment was manually stopped before completion. */
  CANCELLED = 'CANCELLED',
}
