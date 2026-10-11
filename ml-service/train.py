"""
train.py — Train the XGBoost signal quality classifier from backtest output.

Workflow
--------
1. Run backtests for BTC, ETH, SOL:
       POST /api/v1/backtest/run  (see ml-service/README.md for the curl)
2. Download 15m candles for each symbol:
       python download_candles.py --symbol BTCUSDT --interval 15m --out data/btc_15m.csv
       python download_candles.py --symbol ETHUSDT --interval 15m --out data/eth_15m.csv
       python download_candles.py --symbol SOLUSDT --interval 15m --out data/sol_15m.csv
3. Train:
       python train.py \\
         --trades  data/btc_15m_backtest.json data/eth_15m_backtest.json data/sol_15m_backtest.json \\
         --candles-dir data/
4. Hot-load the result:
       curl -X POST http://localhost:8001/reload

Single-symbol usage still works:
       python train.py --trades data/backtest_result.json --candles data/candles.csv

The script
----------
  a. Reads one or more BacktestResult JSON files — merges all report.trades[].
  b. For each trade, resolves the OHLCV candle file by normalising the symbol:
       "BTC/USDT" → btc_15m.csv  (looks for <symbol_base>_15m.csv then candles.csv)
  c. Calls features.build_features() to compute the 14-feature vector.
  d. Labels each trade: 1 = netPnl > 0 (win), 0 = loss.
  e. Trains an XGBClassifier (walk-forward: chronological train/test split).
  f. Prints evaluation metrics on the held-out test period.
  g. Saves the model artifact to models/signal_classifier.json.

Requires: xgboost, pandas, numpy, scikit-learn  (all in requirements.txt)
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import accuracy_score, classification_report, roc_auc_score

from features import FEATURE_COLS, build_features

# ─── Strategy defaults used for feature extraction ────────────────────────────
# Must match the parameters in the backtest request body.
DEFAULT_STRATEGY_PARAMS = {
    "ema_period_fast": 50,
    "ema_period_slow": 200,
    "atr_period": 14,
    "vol_ma_period": 20,
    "donchian_window": 20,
}


def load_candles(path: str | Path) -> pd.DataFrame:
    df = pd.read_csv(
        path,
        dtype={
            "open_time": "int64",
            "open": "float64",
            "high": "float64",
            "low": "float64",
            "close": "float64",
            "volume": "float64",
        },
    )
    df = df.sort_values("open_time").reset_index(drop=True)
    return df


def symbol_to_candle_path(symbol: str, candles_dir: str | None, single_candles: str | None) -> Path | None:
    """
    Resolve which candle CSV to use for a given trade symbol.

    Resolution order (first match wins):
      1. If single_candles is provided and no candles_dir, use it unconditionally.
      2. In candles_dir, look for <base>_15m.csv  (e.g. BTC/USDT → btc_15m.csv)
      3. In candles_dir, look for <base>_1h.csv
      4. In candles_dir, look for candles.csv
      5. Fall back to single_candles if provided.
    """
    if candles_dir is None and single_candles is not None:
        return Path(single_candles)

    base = symbol.split("/")[0].lower()  # "BTC/USDT" → "btc"
    candidates = []

    if candles_dir:
        d = Path(candles_dir)
        candidates += [
            d / f"{base}_15m.csv",
            d / f"{base}_1h.csv",
            d / "candles.csv",
        ]

    if single_candles:
        candidates.append(Path(single_candles))

    for p in candidates:
        if p.exists():
            return p

    return None


def load_trades_from_file(path: str | Path) -> list[dict]:
    """Load the trades list from a BacktestResult JSON (handles UTF-8 BOM)."""
    with open(path, encoding="utf-8-sig") as f:
        data = json.load(f)
    report = data.get("report", data)
    return report.get("trades", [])


def build_dataset(
    trades: list[dict],
    candles_dir: str | None,
    single_candles: str | None,
    strategy_params: dict,
) -> tuple[np.ndarray, np.ndarray]:
    """
    For every trade, extract features at entry time and assign label.

    Returns (X, y) as numpy arrays — X shape (n, n_features), y shape (n,).
    Trades with insufficient candle history or missing candle file are silently dropped.
    """
    # Cache loaded candle DataFrames by their resolved path to avoid re-reading
    candle_cache: dict[str, pd.DataFrame] = {}

    rows: list[list[float]] = []
    labels: list[int] = []
    skipped_candles = 0
    skipped_history = 0

    for trade in trades:
        entry_ts = int(trade["entryTime"])
        symbol = str(trade.get("symbol", ""))
        label = 1 if trade["netPnl"] > 0 else 0

        candle_path = symbol_to_candle_path(symbol, candles_dir, single_candles)
        if candle_path is None:
            skipped_candles += 1
            continue

        path_str = str(candle_path)
        if path_str not in candle_cache:
            candle_cache[path_str] = load_candles(candle_path)
        candles = candle_cache[path_str]

        feat = build_features(candles, strategy_params, entry_ts)
        if feat is None:
            skipped_history += 1
            continue

        rows.append([feat[col] for col in FEATURE_COLS])
        labels.append(label)

    if skipped_candles:
        print(f"[train] Dropped {skipped_candles} trades (no candle file found for symbol)")
    if skipped_history:
        print(f"[train] Dropped {skipped_history} trades (insufficient candle history at entry)")

    X = np.array(rows, dtype=np.float32)
    y = np.array(labels, dtype=np.int32)
    return X, y


def main() -> None:
    parser = argparse.ArgumentParser(description="Train XGBoost signal classifier")
    parser.add_argument(
        "--trades",
        nargs="+",
        required=True,
        help="One or more backtest result JSON files (BacktestResult). All trade lists are merged.",
    )
    parser.add_argument(
        "--candles",
        default=None,
        help="Single OHLCV CSV (open_time,open,high,low,close,volume). "
             "Used when all trades share one symbol, or as a fallback.",
    )
    parser.add_argument(
        "--candles-dir",
        default=None,
        help="Directory containing per-symbol CSVs named <base>_15m.csv "
             "(e.g. btc_15m.csv, eth_15m.csv, sol_15m.csv). "
             "Takes precedence over --candles when provided.",
    )
    parser.add_argument(
        "--out",
        default="models/signal_classifier.json",
        help="Output model path (default: models/signal_classifier.json)",
    )
    parser.add_argument(
        "--min-trades",
        type=int,
        default=50,
        help="Minimum usable trades required to proceed (default: 50)",
    )
    parser.add_argument(
        "--test-size",
        type=float,
        default=0.2,
        help="Walk-forward test fraction — last N%% of trades (default: 0.2)",
    )
    parser.add_argument(
        "--confidence-threshold",
        type=float,
        default=0.45,
        help="Classification threshold for the evaluation report (default: 0.45)",
    )
    args = parser.parse_args()

    if args.candles is None and args.candles_dir is None:
        print("[train] ERROR: Provide --candles <path> or --candles-dir <dir>")
        sys.exit(1)

    # ── Load and merge trades from all input files ──────────────────────────────
    all_trades: list[dict] = []
    for trade_file in args.trades:
        print(f"[train] Loading trades from {trade_file} ...")
        file_trades = load_trades_from_file(trade_file)
        print(f"[train]   {len(file_trades)} trades")
        all_trades.extend(file_trades)

    # Chronological sort so the walk-forward split is meaningful
    all_trades.sort(key=lambda t: t["entryTime"])

    # De-duplicate by (symbol, entryTime) — rare but possible if the same backtest is loaded twice
    seen: set[tuple] = set()
    deduped: list[dict] = []
    for t in all_trades:
        key = (t.get("symbol", ""), int(t["entryTime"]))
        if key not in seen:
            seen.add(key)
            deduped.append(t)
    if len(deduped) < len(all_trades):
        print(f"[train] Removed {len(all_trades) - len(deduped)} duplicate trades")
    all_trades = deduped

    print(f"[train] Total trades: {len(all_trades)}")
    win_pct_raw = sum(1 for t in all_trades if t["netPnl"] > 0) / max(len(all_trades), 1)
    print(f"[train]   Win rate (raw): {win_pct_raw:.1%}")

    # Symbol breakdown
    from collections import Counter
    sym_counts = Counter(t.get("symbol", "?") for t in all_trades)
    for sym, cnt in sorted(sym_counts.items()):
        wins = sum(1 for t in all_trades if t.get("symbol") == sym and t["netPnl"] > 0)
        print(f"[train]   {sym:12} {cnt:5} trades  {wins/cnt:.1%} wins")

    # ── Feature extraction ──────────────────────────────────────────────────────
    print("[train] Extracting features ...")
    X, y = build_dataset(all_trades, args.candles_dir, args.candles, DEFAULT_STRATEGY_PARAMS)

    if len(X) < args.min_trades:
        print(
            f"[train] ERROR: Only {len(X)} usable trades (need ≥ {args.min_trades}). "
            "Run a longer backtest or lower --min-trades."
        )
        sys.exit(1)

    win_rate = y.mean()
    print(f"[train] Dataset ready: {len(X)} trades, win rate = {win_rate:.1%}")
    print(f"[train] Features ({len(FEATURE_COLS)}): {', '.join(FEATURE_COLS)}")

    # ── Walk-forward split (chronological — no shuffle) ───────────────────────
    split = int(len(X) * (1 - args.test_size))
    X_train, X_test = X[:split], X[split:]
    y_train, y_test = y[:split], y[split:]
    print(f"[train] Train: {len(X_train)}  |  Test (held-out): {len(X_test)}")

    # ── Train ─────────────────────────────────────────────────────────────────
    print("[train] Training XGBClassifier ...")
    scale_pos_weight = float((y_train == 0).sum()) / max(float((y_train == 1).sum()), 1.0)
    print(f"[train] scale_pos_weight = {scale_pos_weight:.2f}  (handles class imbalance)")

    clf = xgb.XGBClassifier(
        n_estimators=600,
        max_depth=4,
        learning_rate=0.04,
        subsample=0.8,
        colsample_bytree=0.8,
        min_child_weight=5,
        gamma=1.0,
        reg_alpha=0.1,
        reg_lambda=1.0,
        scale_pos_weight=scale_pos_weight,
        objective="binary:logistic",
        eval_metric="auc",
        early_stopping_rounds=40,
        random_state=42,
        verbosity=0,
    )

    # Wrap as DataFrame so XGBoost records human-readable feature names
    X_train_df = pd.DataFrame(X_train, columns=FEATURE_COLS)
    X_test_df  = pd.DataFrame(X_test,  columns=FEATURE_COLS)

    clf.fit(
        X_train_df,
        y_train,
        eval_set=[(X_train_df, y_train), (X_test_df, y_test)],
        verbose=100,
    )

    # ── Evaluate ──────────────────────────────────────────────────────────────
    print("\n[train] ── Evaluation on held-out test set ──")
    probs = clf.predict_proba(X_test_df)[:, 1]
    preds = (probs >= args.confidence_threshold).astype(int)

    # Threshold sweep: find the threshold that maximises win rate in filtered set
    print("[train] Threshold sweep (signals passing filter vs win rate of filtered set):")
    base_win_rate = float(y_test.mean())
    print(f"         Baseline win rate (unfiltered): {base_win_rate:.1%}")
    for thr in [0.35, 0.40, 0.45, 0.50, 0.55, 0.60, 0.65, 0.70]:
        mask = probs >= thr
        n_pass = mask.sum()
        if n_pass == 0:
            print(f"  thr={thr:.2f}  passes=  0  win_rate=  n/a")
            continue
        wr = float(y_test[mask].mean())
        lift = wr / base_win_rate
        print(f"  thr={thr:.2f}  passes={n_pass:4}  win_rate={wr:.1%}  lift={lift:.2f}x"
              f"{'  ← recommended' if 0.50 <= thr <= 0.60 else ''}")
    print()

    auc = roc_auc_score(y_test, probs) if len(set(y_test)) > 1 else float("nan")
    acc = accuracy_score(y_test, preds)
    print(f"  AUC      : {auc:.4f}  (>0.60 is meaningful edge)")
    print(f"  Accuracy : {acc:.4f}  (threshold={args.confidence_threshold})")
    print()
    print(classification_report(y_test, preds, target_names=["loss", "win"], zero_division=0))

    # Feature importance (with human-readable names from the DataFrame fit)
    importance = clf.get_booster().get_score(importance_type="gain")
    if importance:
        print("[train] Top features by gain:")
        for name, score in sorted(importance.items(), key=lambda x: -x[1])[:10]:
            print(f"  {name:<16} {score:.1f}")
        print()

    if auc < 0.55:
        print(
            "[train] WARNING: AUC < 0.55 — the model has little predictive edge.\n"
            "         Consider using the parameter optimizer to improve strategy quality,\n"
            "         then retrain on the optimized backtest output."
        )

    # ── Save ──────────────────────────────────────────────────────────────────
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    clf.save_model(str(out_path))
    print(f"[train] Model saved → {out_path.resolve()}")
    print()
    print("[train] Hot-load into the running sidecar (no restart needed):")
    print("        curl -X POST http://localhost:8001/reload")
    print("        # or: Invoke-RestMethod -Uri http://localhost:8001/reload -Method POST")


if __name__ == "__main__":
    main()
