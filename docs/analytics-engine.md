# Performance Analytics Engine

> Milestone 26 — Read-Only Analytics Layer

The Analytics Engine is a **pure read-only** subsystem that measures trading performance. It never submits orders and never modifies strategy state. Every computation produces an immutable `AnalyticsSnapshot` that is persisted to Redis and queryable in full historical depth.

---

## Architecture

```
Execution Reports (PaperFillRecord[])
  └─► AnalyticsDataCollectorService
        │  reads from: PaperStateStoreService
        │              PaperAccountService
        │              PaperPortfolioManagerService
        ▼
      Raw Analytics Types
        │  AnalyticsTrade  AnalyticsFill  AnalyticsEquityPoint
        │  AnalyticsPositionSnapshot  DailyCapitalRecord
        ▼
      AnalyticsEngineService  (orchestrator)
        ├─► PerformanceCalculator
        ├─► RiskMetricsCalculator
        ├─► TradeMetricsCalculator
        ├─► ExposureCalculator
        ├─► ExecutionAnalyticsCalculator
        ├─► CapitalMetricsCalculator
        ├─► RollingMetricsCalculator
        └─► BenchmarkCalculator
              ▼
           AnalyticsSnapshot  (immutable; new UUID per compute)
              ▼
           AnalyticsStorageService  →  Redis
              sorted-set  analytics:snapshots  (score = computedAt unix ms)
              string      analytics:snapshot:{id}  (full JSON)
              list        analytics:index           (lightweight summaries)
```

---

## Module Layout

```
src/modules/analytics/
  domain/
    enums/              rolling-window, benchmark-type, export-format
    models/             all metric interfaces
    errors/             typed error hierarchy
  application/
    calculators/        8 pure stateless @Injectable services
    services/           data collector + engine orchestrator
    reports/            AnalyticsReportService (report façade)
    exporters/          CSV, JSON, Parquet (stub)
  storage/              Redis-backed snapshot persistence
  analytics.module.ts
```

---

## Metric Definitions and Formulas

### Performance Metrics (`PerformanceCalculator`)

| Metric | Formula | Notes |
|--------|---------|-------|
| **Net Profit** | `finalEquity − initialCapital` | Quote currency |
| **Gross Profit** | `Σ netPnl` for winning trades | |
| **Gross Loss** | `|Σ netPnl|` for losing trades | Positive value |
| **Average Trade** | `netProfit / totalTrades` | |
| **Median Trade** | Median of sorted `netPnl` array | Uses `n/2` midpoint for even length |
| **Win Rate** | `winningTrades / totalTrades` | Fractional (0–1) |
| **Profit Factor** | `grossProfit / grossLoss` | `Infinity` when grossLoss = 0 and profit > 0; `0` when no trades |
| **Expectancy** | `winRate × avgWin − lossRate × avgLoss` | Expected value per trade |
| **Payoff Ratio** | `avgWin / avgLoss` | `Infinity` when avgLoss = 0 |
| **Recovery Factor** | `netProfit / maxAbsoluteDrawdown` | `0` when drawdown = 0 |
| **Total Return %** | `(finalEquity / initialCapital − 1) × 100` | |
| **Annualized Return %** | `((1 + totalReturn)^(365/periodDays) − 1) × 100` | Requires periodDays > 0 |

---

### Risk Metrics (`RiskMetricsCalculator`)

All ratio metrics are **annualized**.  
Risk-free rate: **5% annual** → `0.05 / 252 ≈ 0.0001984` per day.

| Metric | Formula | Notes |
|--------|---------|-------|
| **Sharpe Ratio** | `(E[r] − Rf) / σ(r) × √252` | `0` when σ = 0 |
| **Sortino Ratio** | `(E[r] − Rf) / σ_down × √252` | `Infinity` when no returns below Rf and E[r] > Rf; `0` when no data |
| **Rolling Sharpe 7d / 30d** | Sharpe using only the most recent 7 or 30 equity points | `0` when fewer points than window |
| **Calmar Ratio** | `annualizedReturn / (maxDrawdown × 100)` | `0` when maxDrawdown = 0 |
| **Omega Ratio** | `Σ max(r, 0) / Σ max(−r, 0)` with threshold = 0 | `Infinity` when no negative returns |
| **Treynor Ratio** | `(E[r] − Rf) / β × √252` | Requires benchmark data; `0` otherwise |
| **Information Ratio** | `α / trackingError` | `0` when trackingError = 0 |
| **Max Drawdown** | `max((peak − equity) / peak)` over all equity points | Fractional (0–1) |
| **Max Drawdown Absolute** | `max(peak − equity)` | Quote currency |
| **Average Drawdown** | `mean(drawdown series)` | Mean of all daily drawdown percentages |
| **Ulcer Index** | `√(mean(drawdown²))` | Penalises deep and prolonged drawdowns |
| **Pain Index** | `mean(drawdown)` | Simple mean of daily drawdown percentages |

**Downside semi-deviation** (for Sortino):  
`σ_down = √(mean(min(r − Rf, 0)²))`  
Computed over **all** returns (not just negative ones), so it correctly reflects how often returns fall below the threshold.

**Drawdown series** is computed by tracking a running peak:
```
peak = max(equity seen so far)
drawdown[i] = (peak − equity[i]) / peak
```

---

### Trade Metrics (`TradeMetricsCalculator`)

| Metric | Formula |
|--------|---------|
| **Average Holding Time** | `mean(exitTime − entryTime)` across all trades |
| **Max / Min Holding Time** | Max / min of durations |
| **Average Bars Held** | `avgHoldingTimeMs / barDurationMs` (0 when barDurationMs = 0) |
| **Max Consecutive Wins** | FIFO scan tracking current streak and global max |
| **Max Consecutive Losses** | Same, for netPnl < 0 |
| **Longest Flat Period** | Max gap between consecutive trade exits |
| **Trade Frequency / Day** | `totalTrades / periodDays` |
| **Trade Frequency / Week** | `tradeFrequencyPerDay × 7` |

---

### Exposure Metrics (`ExposureCalculator`)

| Metric | Formula |
|--------|---------|
| **Gross Exposure** | `Σ |notional|` across all open positions |
| **Net Exposure** | `Σ notional_long − Σ notional_short` |
| **Long Exposure** | `Σ notional` for LONG positions |
| **Short Exposure** | `Σ notional` for SHORT positions |
| **bySymbol** | Per-symbol: notional, direction, `percentOfEquity = notional / totalEquity` |
| **byStrategy** | Aggregated notional and position count per strategyId |
| **byExchange** | Aggregated notional and position count per exchangeId |

---

### Execution Analytics (`ExecutionAnalyticsCalculator`)

| Metric | Formula |
|--------|---------|
| **Average Slippage** | `mean(fill.slippage)` |
| **Median Slippage** | Median of sorted slippage values |
| **Worst Slippage** | `max(fill.slippage)` |
| **Total Slippage** | `Σ fill.slippage` |
| **Average Latency** | `mean(fill.latencyMs)` for fills where latencyMs is set |
| **Median / p95 / Max Latency** | Corresponding percentiles |
| **Order Fill Rate** | `fills / totalSubmitted` (defaults to 1 if totalSubmitted not provided) |
| **Cancel Rate** | `totalCancelled / totalSubmitted` |
| **Rejected Order Rate** | `totalRejected / totalSubmitted` |

---

### Capital Metrics (`CapitalMetricsCalculator`)

Builds time-series curves from daily capital records:

| Field | Meaning |
|-------|---------|
| **equityCurve** | Daily equity with `dailyReturn`, `cumulativeReturn`, `drawdownPercent` |
| **balanceCurve** | Same structure, using `cashBalance` instead of equity |
| **buyingPower** | `max(currentBalance − marginUsed, 0)` |
| **marginUtilizationPercent** | `marginUsed / currentEquity` |
| **leverageUtilization** | `grossExposure / currentEquity` |
| **cashUtilizationPercent** | `(equity − balance) / equity`, clamped to [0, 1] |

**Daily return**: `(equity[i] − equity[i-1]) / equity[i-1]`  
**Cumulative return**: `(equity[i] − equity[first]) / equity[first]`  
**Drawdown percent**: running `(peak − equity) / peak` within the curve

---

### Rolling Metrics (`RollingMetricsCalculator`)

Five standard look-back windows: **7, 30, 90, 180, 365 days**.

For each window, equity points and trades are sliced to `timestamp >= now − windowDays × 86_400_000 ms`, and all metrics are recomputed using only that slice.

`RollingMetrics` bundles all five `RollingWindowMetrics` structs plus a top-level `computedAt` timestamp.

| Metric per Window |
|-------------------|
| totalReturnPercent, annualizedReturnPercent |
| sharpeRatio, sortinoRatio, calmarRatio |
| maxDrawdown, averageDrawdown |
| totalTrades, winRate, profitFactor, netProfit |
| dailyVolatility = `σ(dailyReturns)` |
| annualizedVolatility = `dailyVolatility × √252` |

---

### Benchmark Comparisons (`BenchmarkCalculator`)

Supported types: `BUY_AND_HOLD`, `BTC`, `ETH`, `SP500`, `CUSTOM`.

**Buy & Hold** is always computable from the portfolio's own equity curve (it is the baseline return you would have earned holding the same asset from the first to the last equity point). External benchmarks (BTC, ETH, SPX) require caller-supplied `BenchmarkDailyReturn[]` arrays.

| Metric | Formula |
|--------|---------|
| **Alpha** | `strategyAnnualizedReturn − benchmarkAnnualizedReturn` |
| **Beta** | `Cov(rStrategy, rBenchmark) / Var(rBenchmark)` |
| **Correlation** | Pearson `r` of aligned daily returns |
| **Tracking Error** | `σ(rStrategy − rBenchmark)` over aligned days |
| **Information Ratio** | `alpha / trackingError` |
| **Outperformance Rate** | Fraction of aligned days where strategy outperformed |

Alignment is by date string (YYYY-MM-DD); only days present in **both** series are used.

---

## Persistence

All storage methods catch errors and log them — **never propagate**. A Redis outage will not crash the analytics pipeline; the computed snapshot is still returned to the caller.

| Key pattern | Type | Description |
|-------------|------|-------------|
| `analytics:snapshots` | Redis Sorted Set | Score = `computedAt` unix ms; member = snapshotId |
| `analytics:snapshot:{id}` | Redis String | Full JSON of `AnalyticsSnapshot` |
| `analytics:index` | Redis List | Lightweight `AnalyticsSnapshotSummary` objects, newest first |

Maximum retained snapshots: **500**. When exceeded, the oldest are evicted.

### Querying History

```typescript
// Latest snapshot
const latest = await analyticsEngine.getLatestSnapshot();

// Last N snapshots (default 100)
const history = await analyticsEngine.getSnapshotHistory(50);

// Snapshots within a time range
const range = await analyticsEngine.getSnapshotRange(fromMs, toMs);
```

---

## Data Export

| Format | Service | Methods |
|--------|---------|---------|
| **CSV** | `CsvExporterService` | `exportSnapshotSummary()`, `exportEquityCurve()`, `exportRollingMetrics()`, `exportBenchmarkComparisons()`, `exportExposureBySymbol()` |
| **JSON** | `JsonExporterService` | `exportFullSnapshot()`, `exportMetricsOnly()`, `exportEquityCurve()` |
| **Parquet** | `ParquetExporterService` | Stub — `isAvailable = false`; planned for future release |

**Infinity handling**: `JSON.stringify` converts `Infinity` to `null`. The JSON exporter uses a custom replacer that converts `Infinity → "Infinity"` and `NaN → "NaN"` to preserve information.

---

## Error Hierarchy

```
AnalyticsError (abstract)
  AnalyticsInsufficientDataError  — ANALYTICS_INSUFFICIENT_DATA
  AnalyticsDataCollectionError    — ANALYTICS_DATA_COLLECTION_FAILED
  AnalyticsCalculationError       — ANALYTICS_CALCULATION_FAILED
  AnalyticsStorageError           — ANALYTICS_STORAGE_FAILED
  AnalyticsExportError            — ANALYTICS_EXPORT_FAILED
```

---

## Testing

Tests live in `tests/unit/analytics/` and cover all 8 calculators plus the engine orchestrator.

```
tests/unit/analytics/
  performance.calculator.spec.ts       — 21 tests
  risk-metrics.calculator.spec.ts      — 22 tests
  trade-metrics.calculator.spec.ts     — 17 tests
  exposure.calculator.spec.ts          — 15 tests
  execution-analytics.calculator.spec.ts — 14 tests
  capital-metrics.calculator.spec.ts   — 19 tests
  rolling-metrics.calculator.spec.ts   — 17 tests
  analytics-engine.spec.ts             — 22 tests (all deps mocked)
```

All calculators are instantiated directly with `new Calculator()` — no NestJS testing module is needed since they are pure stateless services.

Run the suite:

```bash
pnpm test -- --testPathPattern="tests/unit/analytics"
```

---

## Performance Considerations

- All 8 calculators are pure functions (no I/O, no shared state). They may be called in parallel once their inputs are ready.
- The data collection phase runs all 6 collector calls concurrently via `Promise.all`.
- Snapshot JSON serialization is synchronous. For very large equity curves (>10,000 points), consider using `exportEquityCurve()` streaming rather than the full snapshot.
- The sorted-set score is `computedAt` in unix milliseconds, making range queries O(log N + M) on the Redis side.
- `trimToMaxSize` is called on every write and evicts the oldest entries when the set exceeds MAX_SNAPSHOTS = 500.
