# Quant Research Sandbox — Research Workflow Guide

> **Milestone 34** — Read this document before running any experiments.

## Overview

The Research Sandbox is an **isolated** environment for developing, testing, and promoting quantitative trading strategies. It is completely separate from the live trading system — no experiment can submit orders, modify positions, or touch production data stores.

The sandbox supports:
- Custom indicators and signal generators
- Experimental strategies (SMA crossover, ML-based, ONNX models, Python scripts)
- Feature engineering pipelines (z-score, min-max, log-return, rank, etc.)
- Factor model decomposition (market, momentum, volatility, liquidity, carry, OI)
- Market regime detection (6 regimes × Hurst exponent refinement)
- Statistical significance gating (Welch t-test, p < 0.05 required)
- Full experiment reproducibility (commit hash + random seed + serialised config)

---

## Quick Start

```typescript
// 1. Create an experiment
const experiment = await experimentTracker.create({
  name: 'SMA-20-100 BTC/USDT 1h',
  description: 'SMA crossover strategy on BTC/USDT 1-hour bars',
  config: {
    datasetConfig: {
      exchangeId: 'binance',
      symbol: 'BTC/USDT',
      timeframe: '1h',
      startTimeMs: new Date('2023-01-01').getTime(),
      endTimeMs:   new Date('2024-01-01').getTime(),
      dataTypes: [ResearchDataType.OHLCV],
    },
    parameters: { fastPeriod: 20, slowPeriod: 100 },
    mlFramework: MlFramework.TYPESCRIPT_NATIVE,
    initialCapitalUsd: 10_000,
    commissionBps: 10,
    slippageBps: 5,
  },
  randomSeed: 42,
  tags: ['momentum', 'crypto'],
});

// 2. Run it
const result = await experimentRunner.run(experiment.id);

// 3. Check statistical validity
console.log(`Sharpe: ${result.metrics.sharpeRatio}`);
console.log(`p-value: ${result.metrics.pValue} (valid: ${result.metrics.isStatisticallyValid})`);

// 4. Generate a report comparing all valid experiments
const report = await researchReport.generateReport({ rankingMetric: 'sharpeRatio' });
console.log(researchReport.formatSummary(report));

// 5. Promote to the next pipeline stage (if metrics pass)
const validation = await promotionPipeline.promote({
  experimentId: experiment.id,
  targetStage: PromotionStage.VALIDATION,
  initiatedBy: 'researcher@example.com',
  reason: 'Sharpe 1.8, MaxDD 12%, p=0.02',
  requestedAt: new Date(),
});
```

---

## ML Backends

### TypeScript Native (default)
Implements a parameter-driven SMA crossover signal. No external dependencies.

```typescript
mlFramework: MlFramework.TYPESCRIPT_NATIVE,
parameters: { fastPeriod: 10, slowPeriod: 30 },
```

### Python (TensorFlow / PyTorch)
Delegates to a Python subprocess via JSON stdin/stdout. The Python script must:
1. Be in the `research/python/scripts/` directory.
2. Export a `run(payload: dict) -> dict` function.
3. Return a `signals` key containing `[1 | -1 | 0]` per bar.

```typescript
mlFramework: MlFramework.PYTHON_TENSORFLOW,
pythonScriptPath: 'lstm_strategy',   // maps to research/python/scripts/lstm_strategy.py
parameters: { hiddenUnits: 64, dropout: 0.2 },
```

### ONNX (pre-trained model inference)
Loads a model from disk and runs inference using `onnxruntime-node`.

```typescript
mlFramework: MlFramework.ONNX,
onnxModelPath: '/research/models/transformer_v2.onnx',
parameters: { lookback: 60 },
```

Install: `pnpm add onnxruntime-node` (optional peer dependency).

---

## Feature Engineering

Define a feature pipeline that runs on raw OHLCV bars before the model.

```typescript
featureEngineering: {
  warmupBars: 50,
  features: [
    { name: 'rsi_14',   source: 'close',  transform: 'ZSCORE',     window: 14 },
    { name: 'vol_20',   source: 'volume', transform: 'MIN_MAX',    window: 20 },
    { name: 'ret_lag1', source: 'close',  transform: 'LOG_RETURN', lag: 1 },
    { name: 'vwap_rank',source: 'hlc3',   transform: 'RANK',       window: 100 },
  ],
},
```

**Supported transforms**: `ZSCORE`, `MIN_MAX`, `LOG_RETURN`, `PCT_CHANGE`, `DIFF`, `RANK`, `NONE`.

Warmup bars are automatically discarded — the result matrix starts at bar `warmupBars`.

---

## Factor Model

Decompose experiment returns into systematic factor exposures:

```typescript
const factorResult = factorModelService.computeFactorModel(
  experiment.id,
  dataset.candles,
  [
    { type: FactorType.MARKET,          lookbackBars: 1,   description: 'Market beta' },
    { type: FactorType.MOMENTUM_SHORT,  lookbackBars: 5,   description: '5-bar momentum' },
    { type: FactorType.VOLATILITY,      lookbackBars: 20,  description: 'Realised vol factor' },
    { type: FactorType.FUNDING_CARRY,   lookbackBars: 8,   description: '8h funding carry' },
  ],
  dataset.fundingRates,
  dataset.openInterest,
);

console.log(`Total R²: ${factorResult.totalRSquared.toFixed(3)}`);
console.log(`Annualised alpha: ${(factorResult.annualizedAlpha * 100).toFixed(2)}%`);
```

---

## Market Regime Detection

Classify market conditions into one of 6 regimes using SMA crossover, realised volatility, and Hurst exponent:

```typescript
const regimes = marketRegimeDetector.detect(dataset.candles, {
  shortMaWindow: 20,
  longMaWindow: 100,
  volWindow: 20,
  lowVolThreshold: 0.30,   // 30% annualised vol
  highVolThreshold: 0.80,  // 80% annualised vol
  hurstWindow: 40,
});

console.log(`Transitions: ${regimes.transitionCount}`);
console.log(`Avg duration: ${regimes.avgRegimeDurationBars} bars`);

// Check what fraction of time was bull market
const bullTime = regimes.regimeDistribution[MarketRegime.BULL_QUIET]
                + regimes.regimeDistribution[MarketRegime.BULL_VOLATILE];
console.log(`Bull market: ${(bullTime * 100).toFixed(1)}% of bars`);
```

---

## Alternative Data

The following data types are declared in `ResearchDataType` but require custom integration:

| Data Type       | Status   | Integration point            |
|-----------------|----------|------------------------------|
| OHLCV           | ✅ Active | HistoricalLoaderFactoryService |
| FUNDING_RATE    | 🔧 Stub  | ResearchDataService.loadFundingRates() |
| OPEN_INTEREST   | 🔧 Stub  | ResearchDataService.loadOpenInterest() |
| LIQUIDATIONS    | 🔧 Stub  | ResearchDataService.loadLiquidations() |
| VOLUME_PROFILE  | 🔧 Stub  | ResearchDataService.loadVolumeProfile() |
| ORDER_BOOK      | 🔧 Stub  | ResearchDataService.loadOrderBookSnapshots() |

To integrate a data provider: replace the `return []` stub body in the corresponding private method of `ResearchDataService`.

---

## Reproducibility

Every experiment is reproducible by design:

| Field         | How captured                        | Where stored       |
|---------------|-------------------------------------|--------------------|
| `commitHash`  | `git rev-parse HEAD` at create time | Experiment record  |
| `randomSeed`  | Explicitly set by researcher        | Experiment record  |
| `config`      | JSON-serialised at create time      | Experiment record  |
| Result        | Stored verbatim after each run      | `research:result:{id}` Redis key |

To reproduce an experiment:
1. Check out the exact commit: `git checkout <commitHash>`
2. Re-run with the same experiment ID: `experimentRunner.run(id)`

JSON round-trip validation is performed at creation — configs with non-serialisable values (functions, circular refs, `undefined`) are rejected at create time with `ResearchReproducibilityError`.

---

## Isolation Guarantee

The Research Sandbox **never**:
- Submits orders via ExecutionModule
- Reads or writes live portfolio state via PortfolioModule
- Calls the production risk engine (RiskModule)
- Modifies live orders (OrderModule)

Any attempt to call these systems throws `ResearchProductionContaminationError` immediately.

Isolation is enforced at the NestJS module boundary: `ResearchModule` only imports `BacktestModule` (read-only historical data). The DI container cannot wire production services into research providers.

---

## Report Generation

```typescript
// Default: rank all completed experiments by Sharpe ratio, exclude p ≥ 0.05
const report = await researchReport.generateReport();

// Custom: composite weighted score, show top 20, include failed-stat experiments
const report = await researchReport.generateReport({
  compositeWeights: {
    sharpe: 0.35, sortino: 0.25, maxDrawdown: 0.20,
    totalReturn: 0.10, profitFactor: 0.10,
  },
  topN: 20,
  filter: { includeInvalid: false },
});

// Compare specific experiments
const comparison = await researchReport.compareExperiments(
  ['exp-001', 'exp-002', 'exp-003'],
  { rankingMetric: 'calmarRatio' },
);

console.log(researchReport.formatSummary(report));
```

**Statistical rejection**: experiments with p ≥ 0.05 (returns not statistically distinguishable from zero) appear in `report.statisticallyRejected` and are excluded from `report.ranked` unless `filter.includeInvalid: true`.
