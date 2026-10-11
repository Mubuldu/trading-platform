/** Strategy used to enumerate parameter combinations during a sweep. */
export enum SweepMethod {
  /** Exhaustive Cartesian product of all parameter values. */
  GRID = 'GRID',
  /** Random samples drawn from continuous ranges. */
  RANDOM = 'RANDOM',
}
