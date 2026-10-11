"""
ML Signal Sidecar — FastAPI server for the XGBoost signal quality classifier.

Endpoints
---------
POST /predict  — Score a 12-feature candidate entry. Returns confidence + signal.
GET  /health   — Liveness + model status.
POST /reload   — Hot-reload the model from ML_MODEL_PATH without restarting.

Graceful-degradation contract (mirrors MlSignalService in NestJS)
-----------------------------------------------------------------
When the model file doesn't exist (before the first training run), every
/predict response returns modelVersion='unloaded'.  NestJS treats that as a
pass-through — all signals enter, identical to running without ML.

Architecture
-----------
  main.py      — FastAPI routes (this file)
  model.py     — SignalModel: loads/reloads/predicts from the XGBoost artifact
  features.py  — Feature engineering helpers shared between inference and train.py

Usage
-----
  docker compose -f docker-compose.dev.yml up ml-service
  # or locally:
  ML_MODEL_PATH=models/signal_classifier.json uvicorn main:app --port 8001
"""

import os
from pathlib import Path
from typing import Literal

from fastapi import FastAPI
from pydantic import BaseModel

from model import SignalModel

# ─── Config ───────────────────────────────────────────────────────────────────

_model_path = Path(os.getenv("ML_MODEL_PATH", "/app/models/signal_classifier.json"))
_model = SignalModel(model_path=_model_path)

# ─── App ──────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Trading Platform — ML Signal Service",
    description="XGBoost signal quality classifier for TrendFollowingV1Strategy.",
    version="1.0.0",
)

# ─── Schemas ──────────────────────────────────────────────────────────────────


class SignalFeatures(BaseModel):
    """12-feature vector.  Field names must match SignalFeatures in ml-signal.service.ts."""

    ret1h: float
    ret4h: float
    ret24h: float
    ret72h: float
    atrNorm: float
    volRatio: float
    emaSpread: float
    adx: float
    donPos: float
    hourSin: float
    hourCos: float
    dowSin: float


class MlPrediction(BaseModel):
    """Response shape consumed by MlSignalService.score() in NestJS."""

    confidence: float
    signal: Literal["enter", "skip"]
    modelVersion: str


# ─── Endpoints ────────────────────────────────────────────────────────────────


@app.post("/predict", response_model=MlPrediction)
def predict(features: SignalFeatures) -> MlPrediction:
    """
    Score a candidate entry signal.

    When the model is not yet trained returns confidence=0.5, signal='enter',
    modelVersion='unloaded' — NestJS treats this as a pass-through.
    """
    result = _model.predict(features.model_dump())
    return MlPrediction(**result)


@app.get("/health")
def health() -> dict:
    """Liveness + model status.  Called by MlSignalService.healthCheck() in NestJS."""
    return {
        "status": "ok",
        "modelLoaded": _model.is_loaded,
        "modelVersion": _model.model_version,
    }


@app.post("/reload")
def reload() -> dict:
    """
    Hot-reload the model artifact from ML_MODEL_PATH.

    Call this after train.py completes so the live bot picks up the new model
    without a container restart.  Thread-safe — safe to call while /predict runs.
    """
    ok = _model.reload()
    return {
        "reloaded": ok,
        "modelVersion": _model.model_version,
        "modelPath": str(_model_path),
    }
