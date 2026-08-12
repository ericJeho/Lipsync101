# syntax=docker/dockerfile:1
#
# Inference service.
#
# Defaults to the CPU image, which runs the full pipeline in simulation mode —
# real media in and out, no model weights needed. That is what CI and local
# frontend work use. Build with `--target gpu` for the CUDA image.

# ---------------------------------------------------------------------------
# Base — shared by both variants
# ---------------------------------------------------------------------------
FROM python:3.11-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

# ffmpeg is not optional: every probe, extraction and encode goes through it.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY pyproject.toml ./

RUN useradd --uid 1001 --create-home --shell /bin/false lipsync \
    && mkdir -p /data/storage /data/weights /app/tmp \
    && chown -R lipsync:lipsync /data /app

USER lipsync

ENV AI_STORAGE_DIR=/data/storage \
    AI_WEIGHTS_DIR=/data/weights \
    AI_WORK_DIR=/app/tmp

EXPOSE 8000

ENTRYPOINT ["/usr/bin/tini", "--"]
# One worker: renders are long and hold a GPU, so concurrency belongs at the
# container level, not inside a single process.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]

# ---------------------------------------------------------------------------
# GPU variant
# ---------------------------------------------------------------------------
FROM nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04 AS gpu

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3.11 python3-pip \
      ffmpeg \
      tini \
      libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3.11 /usr/bin/python

WORKDIR /app

# The CUDA wheels are several gigabytes, so this layer is deliberately isolated
# from the application source below it.
COPY requirements.txt requirements-gpu.txt ./
RUN pip install --no-cache-dir -r requirements-gpu.txt

COPY app ./app
COPY pyproject.toml ./

RUN useradd --uid 1001 --create-home --shell /bin/false lipsync \
    && mkdir -p /data/storage /data/weights /app/tmp \
    && chown -R lipsync:lipsync /data /app

USER lipsync

ENV AI_STORAGE_DIR=/data/storage \
    AI_WEIGHTS_DIR=/data/weights \
    AI_WORK_DIR=/app/tmp

EXPOSE 8000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
