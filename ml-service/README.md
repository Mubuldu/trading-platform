# ML Signal Service

XGBoost signal quality filter for `TrendFollowingV1Strategy`.

Before a trade entry the NestJS strategy sends 12 features to this sidecar's
`POST /predict`.  If confidence < 0.55 the signal is skipped.  When the model
isn't trained yet the sidecar returns `modelVersion: 'unloaded'` and NestJS
lets every signal through — same behaviour as running without ML.

---

## Step 1 — Start the stack

```bash
docker compose -f docker-compose.dev.yml up --build
```

The `ml-service` container starts immediately in unloaded mode (no trained
model yet).  The live bot keeps trading normally while you gather data.

---

## Step 2 — Run the backtest to generate training data

> **Windows (PowerShell)** — run from the project root (`C:\...\trading-platform`):

```powershell
# Create data dir
New-Item -ItemType Directory -Force ml-service\data | Out-Null

$body = @'
{
  "symbol":                "BTC/USDT",
  "exchange":              "BINANCE",
  "timeframe":             "1h",
  "dataSource":            "BINANCE",
  "startTime":             1609459200000,
  "endTime":               1735689600000,
  "warmupCandles":         250,
  "initialCapitalUsd":     100000,
  "enableRiskChecks":      false,
  "maxPositionSizePercent": 100,
  "maxDailyLossPercent":   100,
  "fillOnClose":           false,
  "commission": { "makerBps": 10, "takerBps": 10 },
  "slippage":   { "fixedBps": 5, "volumeParticipationRate": 0, "maxSlippageBps": 20 },
  "strategies": [{
    "strategyType": "trend-following-v1",
    "config": {
      "strategyId":       "trend-following-v1",
      "name":             "TrendFollowingV1",
      "version":          "1.0.0",
      "parameters": {
        "emaPeriodFast":               50,
        "emaPeriodSlow":               200,
        "atrPeriod":                   14,
        "atrMultiplier":               2.0,
        "atrMinThreshold":             0,
        "adxPeriod":                   14,
        "adxThreshold":                25,
        "donchianWindow":              20,
        "donchianBreakoutTolerancePct": 0.001,
        "volumeMaPeriod":              20,
        "cooldownCandles":             3,
        "maxHoldingCandles":           72,
        "timeframe":                   "1h"
      },
      "enabled":           true,
      "executionTarget":   "paper_trading"
    }
  }]
}
'@

Write-Host "Running backtest (30-120s)..."
$r = Invoke-WebRequest -UseBasicParsing `
  -Uri http://localhost:3000/api/v1/backtest/run `
  -Method POST -Body $body -ContentType "application/json" `
  -Headers @{"x-api-key"="dev-secret-key-not-for-production-use-only"} `
  -TimeoutSec 180

[IO.File]::WriteAllText("$PWD\ml-service\data\backtest_result.json", $r.Content)

$json = $r.Content | ConvertFrom-Json
$trades = $json.report.trades.Count
$sharpe = [math]::Round($json.report.sharpeRatio, 2)
$wr     = [math]::Round($json.report.winRate * 100, 1)
Write-Host "Done: $trades trades | Sharpe=$sharpe | WinRate=$wr%"
Write-Host "Saved → ml-service\data\backtest_result.json"
```

You need **≥ 50 trades** to train (aim for 200+).  4 years of BTC 1h typically yields 200–400 trades.

This pipes the response through Python to print a summary and save the file.
Expect 10–60 seconds for 4 years of 1h data.  You need **≥ 50 trades** to
train (the more the better — aim for 200+).

---

## Step 3 — Download candles

```bash
python -c "
import urllib.request, json, time, csv, os, sys
os.makedirs('ml-service/data', exist_ok=True)
symbol='BTCUSDT'; tf='1h'
start=1609459200000; end=1735689600000
url='https://api.binance.com/api/v3/klines'
rows=[]; cur=start
while cur < end:
    params=f'symbol={symbol}&interval={tf}&startTime={cur}&limit=1000'
    data=json.loads(urllib.request.urlopen(f'{url}?{params}').read())
    if not data: break
    rows+=data; cur=data[-1][0]+3600000; time.sleep(0.3)
    sys.stderr.write(f'\r{len(rows)} candles...')
with open('ml-service/data/candles.csv','w',newline='') as f:
    w=csv.writer(f)
    w.writerow(['open_time','open','high','low','close','volume'])
    for r in rows: w.writerow([r[0],r[1],r[2],r[3],r[4],r[5]])
print(f'\nSaved {len(rows)} candles to ml-service/data/candles.csv')
"
```

~35 000 rows for 4 years of 1h BTC data.  Takes ~2 min (Binance rate-limits).

---

## Step 4 — Train the model

```bash
cd ml-service
pip install -r requirements.txt     # first time only

python train.py \
  --trades  data/backtest_result.json \
  --candles data/candles.csv \
  --out     models/signal_classifier.json
```

Output looks like:
```
[train] Dataset: 312 trades, win rate = 47.1%
[train] Train: 249 trades | Test (held-out): 63 trades
...
  AUC:      0.6821
  Accuracy: 0.6349  (threshold=0.55)
[train] Top feature importances (gain):
  emaSpread    214.3
  adx          188.1
  ret24h       142.7
  ...
[train] Model saved → models/signal_classifier.json
```

A good model has AUC > 0.60.  If AUC is near 0.50 the signal has no
predictive edge — run a longer backtest or tune strategy parameters first.

---

## Step 5 — Hot-load the model

```bash
curl -X POST http://localhost:8001/reload
```

No container restart needed.  The live bot immediately starts filtering
signals with the new model.  Verify:

```bash
curl http://localhost:8001/health
# → { "modelLoaded": true, "modelVersion": "v1735689601", ... }
```

---

## Re-training

Repeat steps 2–5 after running the parameter optimizer
(`POST /api/v1/backtest/optimize`) and applying the best config.
The model will be retrained on the new strategy parameters.
