/**
 * PluginLifecycleState is the complete state machine for a strategy plugin.
 *
 * Every plugin passes through these states in order. The platform tracks the
 * current state and enforces transition legality — skipping states is not
 * allowed. Any state can transition to ERROR on an unrecoverable failure.
 *
 * Legal transitions:
 *
 *   REGISTERED  → VALIDATED  (validate())
 *   VALIDATED   → COMPILED   (compile())
 *   COMPILED    → LOADED     (load())
 *   LOADED      → INITIALIZED (initialize())
 *   INITIALIZED → WARMED_UP  (warmup())
 *   WARMED_UP   → RUNNING    (run())
 *   RUNNING     → PAUSED     (pause())
 *   PAUSED      → RUNNING    (resume())
 *   RUNNING     → UNLOADED   (unload())
 *   PAUSED      → UNLOADED   (unload())
 *   UNLOADED    → REMOVED    (remove())
 *   ANY         → ERROR      (unrecoverable failure)
 *   ERROR       → REMOVED    (operator cleanup)
 *
 * Diagram:
 *
 *   REGISTERED → VALIDATED → COMPILED → LOADED → INITIALIZED → WARMED_UP
 *                                                                    ↓
 *   REMOVED ← UNLOADED ← ┌── RUNNING ←──────────────────────────────┘
 *                         │     ↕ (pause/resume)
 *                         └── PAUSED
 *
 *   Any state → ERROR → REMOVED
 */
export enum PluginLifecycleState {
  /** Manifest loaded; not yet validated. */
  REGISTERED  = 'REGISTERED',
  /** Manifest, permissions, and SDK version validated. */
  VALIDATED   = 'VALIDATED',
  /** Module compiled or require()'d successfully. */
  COMPILED    = 'COMPILED',
  /** SdkStrategy instance constructed; not yet initialized. */
  LOADED      = 'LOADED',
  /** onInitialize() completed successfully. */
  INITIALIZED = 'INITIALIZED',
  /** onWarmup() completed; strategy ready to receive live market events. */
  WARMED_UP   = 'WARMED_UP',
  /** Receiving live market events and generating signals. */
  RUNNING     = 'RUNNING',
  /** Temporarily halted; no events dispatched; resumes without re-warmup. */
  PAUSED      = 'PAUSED',
  /** Strategy instance destroyed; manifest still held. */
  UNLOADED    = 'UNLOADED',
  /** Fully removed; manifest discarded. */
  REMOVED     = 'REMOVED',
  /** Unrecoverable error; operator intervention required. */
  ERROR       = 'ERROR',
}
