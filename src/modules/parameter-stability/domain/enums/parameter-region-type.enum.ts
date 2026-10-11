/**
 * Classification of a parameter region based on the local behaviour
 * of a performance metric as parameters change.
 *
 *   STABLE   — broad plateau; performance is consistently above the median
 *               with low local variance.  Ideal: strategy is robust here.
 *
 *   UNSTABLE — high local variance; small parameter changes cause large,
 *               erratic swings in performance.
 *
 *   CLIFF    — abrupt drop in metric at the region boundary.  The strategy
 *               works well on one side and fails on the other.  Danger: the
 *               live parameter may drift across the cliff.
 *
 *   ISLAND   — a narrow, isolated zone of good performance surrounded by
 *               poor results.  Classic signature of over-fitting: the
 *               optimiser found a lucky pocket that will not generalise.
 */
export type ParameterRegionType = 'STABLE' | 'UNSTABLE' | 'CLIFF' | 'ISLAND';
