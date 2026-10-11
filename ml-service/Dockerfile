# ─── ML Signal Sidecar ────────────────────────────────────────────────────────
# Lightweight FastAPI + XGBoost server.
# Build context: ./ml-service  (set in docker-compose.dev.yml)

FROM python:3.11-slim

WORKDIR /app

# Install dependencies first (layer-cached unless requirements.txt changes)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY main.py model.py features.py ./

# Model artifacts are mounted at runtime via the ml-models volume.
# The /app/models directory is created here so Docker can mount into it.
RUN mkdir -p /app/models

EXPOSE 8001

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "1"]
