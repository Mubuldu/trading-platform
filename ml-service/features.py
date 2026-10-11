"""
features.py — Feature engineering for the ML signal classifier.

Two public entry points:

  build_features(df, params, entry_ts_ms)
      Accepts a pandas DataFrame of OHLCV candles (sorted ascending by
      open_time) and a dict of strategy params.  Returns a dict whose keys
      match SignalFeatures in ml-signal.service.ts (camelCase).
      Used by train.py to label historical trades.

  dict_to_array(feature_dict)
      Converts the JSON body received by POST /predict into the 1-D numpy
      array that XGBoost's predict_proba() expects.
      The column order MUST match the order used during training — both
      functions use FEATURE_COLS as the single source of truth.

Feature changelog
-----------------
v2 (current): added rsi14 and pdiNdiRatio.
  rsi14        — RSI(14) [0–100]: momentum quality at entry. High RSI on a
                 breakout entry is expected (momentum confirmation); very high RSI
                 (>80) can flag exhaustion.
  pdiNdiRatio  — (PDI − NDI) / (PDI + NDI) ∈ [−1, +1]: directional conviction
                 behind ADX.  +1 = pure bullish, −1 = pure bearish. Captures the
                 directionality that ADX magnitude alone misses.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd

# ──────────────────────────────────────────────────────────────────────────────
# Column contract — order must be identical in training and inference
# ──────────────────────────────────────────────────────────────────────────────
FEATURE_COLS: list[str] = [
    "ret1h",        # 1-bar return
    "ret4h",        # 4-bar return
    "ret24h",       # 24-bar return
    "ret72h",       # 72-bar return
    "atrNorm",      # ATR(14) / close
    "volRatio",     # volume / volumeMA(20)
    "emaSpread",    # (emaFast − emaSlow) / emaSlow
    "adx",          # ADX(14)
    "donPos",       # (close − donLow) / (donHigh − donLow)  [0, 1]
    "hourSin",      # sin(2π × hour / 24)
    "hourCos",      # cos(2π × hour / 24)
    "dowSin",       # sin(2π × weekday / 7)
    # v2 additions
    "rsi14",        # RSI(14) [0–100] — momentum quality at entry
    "pdiNdiRatio",  # (PDI − NDI) / (PDI + NDI) ∈ [−1, +1] — directional conviction
]

# Minimum rows needed to compute the slowest feature (ret72h)
MIN_ROWS_REQUIRED = 73


def build_features(
    df: pd.DataFrame,
    params: dict[str, Any],
    entry_ts_ms: int,
) -> dict[str, float] | None:
    """
    Extract features from the candle history at a given entry timestamp.

    Parameters
    ----------
    df : pd.DataFrame
        OHLCV candles sorted ascending by ``open_time`` (Unix ms).
        Required columns: open_time, open, high, low, close, volume.
    params : dict
        Strategy params.  Keys used:
          ema_period_fast, ema_period_slow,
          atr_period (default 14), vol_ma_period (default 20),
          donchian_window (default 20).
    entry_ts_ms : int
        Epoch milliseconds of the candle whose close triggered the signal.
        Features are built from candles UP TO AND INCLUDING this candle.

    Returns
    -------
    dict[str, float] or None
        Feature dict with FEATURE_COLS keys, or None if there is insufficient
        history.
    """
    # Slice candles up to and including the entry candle
    mask = df["open_time"] <= entry_ts_ms
    hist = df[mask].copy().reset_index(drop=True)

    if len(hist) < MIN_ROWS_REQUIRED:
        return None  # not enough history

    close = hist["close"]
    volume = hist["volume"]
    n = len(hist)

    # ── Price momentum (returns) ──────────────────────────────────────────────
    def pct_ret(lookback: int) -> float:
        if n <= lookback:
            return 0.0
        past = close.iloc[n - 1 - lookback]
        return float(close.iloc[-1] / past - 1.0) if past != 0 else 0.0

    ret1h = pct_ret(1)
    ret4h = pct_ret(4)
    ret24h = pct_ret(24)
    ret72h = pct_ret(72)

    # ── ATR(14) normalised by close ───────────────────────────────────────────
    atr_period: int = int(params.get("atr_period", 14))
    atr_val = _compute_atr(hist, atr_period)
    close_last = float(close.iloc[-1])
    atr_norm = float(atr_val / close_last) if close_last != 0 else 0.0

    # ── Volume ratio: volume / volumeMA(20) ───────────────────────────────────
    vol_ma_period: int = int(params.get("vol_ma_period", 20))
    vol_ma = float(volume.iloc[-vol_ma_period:].mean()) if n >= vol_ma_period else float(volume.mean())
    vol_ratio = float(volume.iloc[-1] / vol_ma) if vol_ma != 0 else 1.0

    # ── EMA spread: (emaFast − emaSlow) / emaSlow ────────────────────────────
    fast_period: int = int(params.get("ema_period_fast", 50))
    slow_period: int = int(params.get("ema_period_slow", 200))
    ema_fast = float(close.ewm(span=fast_period, adjust=False).mean().iloc[-1])
    ema_slow = float(close.ewm(span=slow_period, adjust=False).mean().iloc[-1])
    ema_spread = float((ema_fast - ema_slow) / ema_slow) if ema_slow != 0 else 0.0

    # ── ADX(14) + PDI/NDI ────────────────────────────────────────────────────
    adx_val, pdi_val, ndi_val = _compute_adx_full(hist, atr_period)
    pdi_ndi_sum = pdi_val + ndi_val
    pdi_ndi_ratio = float((pdi_val - ndi_val) / pdi_ndi_sum) if pdi_ndi_sum > 0 else 0.0

    # ── RSI(14) ───────────────────────────────────────────────────────────────
    rsi14 = _compute_rsi(close, 14)

    # ── Donchian position: (close − low) / (high − low) ──────────────────────
    don_window: int = int(params.get("donchian_window", 20))
    don_high = float(hist["high"].iloc[-don_window:].max())
    don_low = float(hist["low"].iloc[-don_window:].min())
    don_range = don_high - don_low
    don_pos = float((close_last - don_low) / don_range) if don_range != 0 else 0.5

    # ── Time features ─────────────────────────────────────────────────────────
    ts_sec = entry_ts_ms / 1000.0
    dt = pd.Timestamp(ts_sec, unit="s", tz="UTC")
    hour = dt.hour + dt.minute / 60.0
    dow = dt.dayofweek  # 0 = Monday
    hour_sin = math.sin(2 * math.pi * hour / 24)
    hour_cos = math.cos(2 * math.pi * hour / 24)
    dow_sin = math.sin(2 * math.pi * dow / 7)

    return {
        "ret1h": ret1h,
        "ret4h": ret4h,
        "ret24h": ret24h,
        "ret72h": ret72h,
        "atrNorm": atr_norm,
        "volRatio": vol_ratio,
        "emaSpread": ema_spread,
        "adx": adx_val,
        "donPos": don_pos,
        "hourSin": hour_sin,
        "hourCos": hour_cos,
        "dowSin": dow_sin,
        "rsi14": rsi14,
        "pdiNdiRatio": pdi_ndi_ratio,
    }


def dict_to_array(feature_dict: dict[str, float]) -> np.ndarray:
    """
    Convert a feature dict to a 2-D numpy array shaped (1, n_features).

    The column order follows FEATURE_COLS, which must match the training order.
    Missing keys default to 0.0 — the model handles neutral input gracefully.
    """
    row = [feature_dict.get(col, 0.0) for col in FEATURE_COLS]
    return np.array([row], dtype=np.float32)


# ──────────────────────────────────────────────────────────────────────────────
# Private helpers
# ──────────────────────────────────────────────────────────────────────────────

def _compute_atr(df: pd.DataFrame, period: int) -> float:
    """Wilder's ATR over the last `period` candles."""
    high = df["high"]
    low = df["low"]
    close_prev = df["close"].shift(1)
    tr = pd.concat(
        [
            high - low,
            (high - close_prev).abs(),
            (low - close_prev).abs(),
        ],
        axis=1,
    ).max(axis=1)
    atr_series = tr.ewm(alpha=1.0 / period, adjust=False).mean()
    return float(atr_series.iloc[-1])


def _compute_adx_full(df: pd.DataFrame, period: int) -> tuple[float, float, float]:
    """
    Wilder's ADX — returns (adx, pdi, ndi).

    Splitting from the old _compute_adx so we also get PDI/NDI for the
    pdiNdiRatio feature without recomputing everything twice.
    """
    high = df["high"]
    low = df["low"]
    close_prev = df["close"].shift(1)
    high_prev = high.shift(1)
    low_prev = low.shift(1)

    tr = pd.concat(
        [
            high - low,
            (high - close_prev).abs(),
            (low - close_prev).abs(),
        ],
        axis=1,
    ).max(axis=1)

    plus_dm = (high - high_prev).clip(lower=0.0)
    minus_dm = (low_prev - low).clip(lower=0.0)

    alpha = 1.0 / period
    atr_s = tr.ewm(alpha=alpha, adjust=False).mean()
    plus_di = 100.0 * (plus_dm.ewm(alpha=alpha, adjust=False).mean() / atr_s)
    minus_di = 100.0 * (minus_dm.ewm(alpha=alpha, adjust=False).mean() / atr_s)

    dx_denom = plus_di + minus_di
    dx = (100.0 * (plus_di - minus_di).abs() / dx_denom).where(dx_denom != 0, 0.0)
    adx_series = dx.ewm(alpha=alpha, adjust=False).mean()

    return (
        float(adx_series.iloc[-1]),
        float(plus_di.iloc[-1]),
        float(minus_di.iloc[-1]),
    )


def _compute_rsi(close: pd.Series, period: int = 14) -> float:
    """
    Wilder's RSI.

    Returns a value in [0, 100].  Returns 50.0 if there is insufficient
    history (neutral — the model handles this gracefully).
    """
    if len(close) < period + 1:
        return 50.0
    delta = close.diff()
    gain = delta.clip(lower=0.0).ewm(alpha=1.0 / period, adjust=False).mean()
    loss = (-delta).clip(lower=0.0).ewm(alpha=1.0 / period, adjust=False).mean()
    last_loss = float(loss.iloc[-1])
    if last_loss == 0:
        return 100.0
    rs = float(gain.iloc[-1]) / last_loss
    return float(100.0 - 100.0 / (1.0 + rs))
