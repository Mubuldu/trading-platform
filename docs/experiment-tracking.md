# Experiment Tracking Reference

> **Milestone 34** — Complete reference for experiment IDs, datasets, parameters, commit hashes, results, metrics, and reproduction.

## Experiment Record

Every experiment is identified by a UUID v4 and stores complete reproducibility metadata.

```typescript
interface Experiment {
  id:             string;          // UUID v4 — stable for the lifetime of the experiment
  name:           string;          // Human-readable unique name (enforced at creation)
  description:    string;          // Hypothesis and purpose
  config:         ExperimentConfig; // Complete, JSON-serialised configuration
  commitHash:     string;          // git commit hash at time of creation ('unknown' if git unavailable)
  randomSeed:     number;          // Seed for all RNGs (deterministic results)
  status:         ExperimentStatus; // PENDING | RUNNING | COMPLETED | FAILED | CANCELLED
  promotionStage: PromotionStage;  // Current pipeline stage
  tags:           string[];        // Free-form classification labels
  createdAt:      Date;
  startedAt?:     Date;
  completedAt?:   Date;
  failureReason?: string;
}
```

### Lifecycle Status

```
PENDING → RUNNING → COMPLETED
                 ↘ FAILED
                 ↘ CANCELLED
```

Completed experiments are the only ones eligible for promotion or report inclusion.

---

## Dataset Configuration

The `datasetConfig` field inside `ExperimentConfig` fully specifies the data the experiment sees:

```typescript
interface ResearchDatasetConfig {
  exchangeId:  string;            // e.g. 'binance', 'bybit'
  symbol:      string;            // e.g. 'BTC/USDT'
  timeframe:   string;            // e.g. '1h', '4h', '1d'
  startTimeMs: number;            // Unix milliseconds (inclusive)
  endTimeMs:   number;            // Unix milliseconds (inclusive)
  dataTypes:   ResearchDataType[]; // Which data series to load
}
```

Datasets are in-memory cached by SHA-256 config hash (16-char prefix). Datasets larger than 500,000 candles bypass the cache.

**Minimum bars**: 50 candles are required for any experiment; most analytical services require more (factor model: 60, regime detector: 50).

---

## Parameters

The `parameters` field is an arbitrary `Record<string, unknown>` — fully up to the researcher. The only requirement is that it must be **JSON-serialisable** (no functions, symbols, `undefined` values, or circular references). This is enforced at experiment creation via JSON round-trip validation.

```typescript
// Good — all values are JSON primitives
parameters: { fastPeriod: 10, slowPeriod: 30, threshold: 0.02 }

// Good — nested objects are fine
parameters: { model: { layers: [64, 32], dropout: 0.2 }, lookback: 60 }

// Bad — will throw ResearchReproducibilityError at create time
parameters: { callback: () => {} }
parameters: { value: undefined }
```

---

## Commit Hash Capture

The git commit hash is captured automatically at experiment creation:

```typescript
// Internally calls:
execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim()
```

If git is unavailable (e.g. in certain CI environments without checkout), `commitHash` is set to `'unknown'` and a warning is logged. The experiment can still run but cannot be reproduced from git history.

---

## Experiment Result

Results are persisted separately from experiments (different Redis key) so they can be loaded independently.

```typescript
interface ExperimentResult {
  experimentId: string;
  metrics:      ExperimentMetrics; // See full metrics table below
  equityCurve:  EquityPoint[];     // { timestampMs, equity, drawdownPercent }[]
  trades:       ExperimentTrade[]; // Full trade log with entry/exit/PnL per trade
  customMetrics: Record<string, number>; // Model-specific metrics (e.g. 'accuracy', 'loss')
  rawOutput:    string;            // Verbatim Python stdout (empty for TS native)
  computedAt:   Date;
}
```

---

## Metrics Reference

### Return Metrics

| Metric                     | Description                                               |
|----------------------------|-----------------------------------------------------------|
| `totalReturnPercent`       | Total return over the experiment period (%)               |
| `annualizedReturnPercent`  | Return scaled to annual equivalent (%)                    |
| `cagr`                     | Compound Annual Growth Rate (0..1)                        |

### Risk-Adjusted Performance

| Metric          | Formula                                              | Interpretation    |
|-----------------|------------------------------------------------------|-------------------|
| `sharpeRatio`   | `(R - Rf) / σ_annual`  (Rf = 5%)                   | > 1.0 is good     |
| `sortinoRatio`  | `(R - Rf) / σ_down`                                 | > 1.5 is good     |
| `calmarRatio`   | `CAGR / MaxDD`                                      | > 0.5 is good     |
| `omegaRatio`    | `Σ(gains above threshold) / Σ(losses below threshold)` | > 1.0 is good  |

### Drawdown

| Metric                    | Description                                  |
|---------------------------|----------------------------------------------|
| `maxDrawdownPercent`      | Peak-to-trough maximum loss (%)              |
| `avgDrawdownPercent`      | Average drawdown across all drawdown periods |
| `maxDrawdownDurationDays` | Longest time underwater (days)               |
| `ulcerIndex`              | RMS of drawdown series (lower = better)      |

### Trade Statistics

| Metric                   | Description                                          |
|--------------------------|------------------------------------------------------|
| `tradeCount`             | Total number of completed round-trips                |
| `winRate`                | Fraction of trades with positive net PnL (0..1)      |
| `profitFactor`           | Gross profit / gross loss (> 1.0 = profitable)       |
| `avgWinPercent`          | Average return on winning trades (%)                 |
| `avgLossPercent`         | Average return on losing trades (%, usually negative)|
| `avgHoldingPeriodBars`   | Average trade duration in bars                       |
| `expectancy`             | Expected return per trade = `winRate × avgWin - (1-winRate) × avgLoss` |

### Volatility

| Metric                 | Description                                      |
|------------------------|--------------------------------------------------|
| `annualizedVolatility` | Annualised standard deviation of returns         |
| `downwardVolatility`   | Standard deviation of negative returns only      |

### Statistical Validity

| Metric                 | Description                                                          |
|------------------------|----------------------------------------------------------------------|
| `pValue`               | One-tailed Welch t-test p-value. H₀: mean return = 0                |
| `isStatisticallyValid` | `true` when `pValue < 0.05` (significant positive returns)           |
| `tStatistic`           | t-statistic from the test                                            |
| `degreesOfFreedom`     | Degrees of freedom used in the Student-t CDF computation             |

**Implementation**: Welch t-test → Student-t CDF via incomplete beta function → Lentz continued fraction algorithm → `lgamma` via Lanczos approximation (6-coefficient, error < 1e−11). No external math library.

---

## Redis Storage Layout

| Key Pattern                   | Type        | Contents                                   |
|-------------------------------|-------------|--------------------------------------------|
| `research:experiments`        | Sorted Set  | Score = createdAt ms, member = experimentId |
| `research:experiment:{id}`    | String      | Full JSON blob of `Experiment`             |
| `research:result:{id}`        | String      | Full JSON blob of `ExperimentResult`       |
| `research:promotions:{id}`    | List        | JSON `PromotionRecord[]` (newest first)    |
| `research:name-idx:{hash}`    | String      | FNV-1a hash of name → experimentId        |

**Retention**: maximum 1000 experiments. Oldest are evicted automatically when the limit is exceeded.

---

## Reproducing an Experiment

Given an existing experiment ID, reproduce it identically:

```typescript
// 1. Retrieve the experiment metadata
const exp = await experimentTracker.findById('exp-001');

// 2. Check out the exact commit used
// $ git checkout <exp.commitHash>

// 3. Re-run with the same seed (seedOverride uses exp.randomSeed internally)
const result = await experimentRunner.run(exp.id, { dryRun: true });

// 4. Compare metrics
console.log(`Reproduced Sharpe: ${result.metrics.sharpeRatio}`);
```

For bit-for-bit reproducibility:
- Same `commitHash` (code logic)
- Same `randomSeed` (any random number generation)
- Same `config.datasetConfig` (exact same bars)
- Same `config.parameters` (same hyperparameters)
- Same `config.commissionBps` and `slippageBps` (same P&L simulation)

---

## Querying Experiments

```typescript
// List recent experiments (paginated)
const summaries = await experimentTracker.listAll(offset=0, limit=50);
// Returns ExperimentSummary[] with hasResult flag

// Get one experiment by ID
const exp = await experimentTracker.findById('exp-001');

// Get the result for a completed experiment
const result = await experimentTracker.findResultById('exp-001');

// Get full promotion history
const history = await experimentTracker.getPromotionHistory('exp-001');

// Count all stored experiments
const total = await experimentTracker.count();
```

---

## Error Reference

| Error                             | Condition                                                  |
|-----------------------------------|------------------------------------------------------------|
| `ResearchExperimentNotFoundError` | ID not in storage                                          |
| `ResearchExperimentAlreadyExistsError` | Name already registered                               |
| `ResearchReproducibilityError`    | Config is not JSON-serialisable (non-reproducible)         |
| `ResearchDatasetNotFoundError`    | No OHLCV data available for the given symbol/range         |
| `ResearchInsufficientDataError`   | Fewer bars than the required minimum                       |
| `ResearchPythonBridgeError`       | Python subprocess failed, timed out, or returned bad JSON  |
| `ResearchOnnxInferenceError`      | ONNX session failed; also thrown when `onnxruntime-node` is not installed |
| `ResearchStatisticalValidationError` | Experiment p-value ≥ 0.05                              |
| `ResearchProductionContaminationError` | Isolation boundary violation                         |
