"""Runtime configuration for the inference service."""

from __future__ import annotations

import shutil
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Environment-driven settings.

    The service is designed to start with none of these set: it detects what is
    actually available (ffmpeg, CUDA, model weights) and reports its real
    capabilities on ``/health`` rather than failing at import time.
    """

    model_config = SettingsConfigDict(env_prefix="AI_", env_file=".env", extra="ignore")

    host: str = "0.0.0.0"
    port: int = 8000

    # Shared secret the Node API presents as a bearer token.
    service_token: str = "dev-ai-token"

    # Where model weights live. Missing weights put an engine into simulation.
    weights_dir: Path = Path("./weights")
    work_dir: Path = Path("./tmp")
    storage_dir: Path = Path("../../storage")

    # Whisper model size: tiny/base/small/medium/large-v3.
    whisper_model: str = "small"

    # Hosts we will fetch media from for URL import. Deliberately a short
    # allowlist: this endpoint fetches attacker-supplied URLs, so anything not
    # named here is refused rather than filtered.
    import_allowed_hosts: tuple[str, ...] = (
        "www.youtube.com",
        "youtube.com",
        "youtu.be",
        "soundcloud.com",
        "vimeo.com",
    )

    max_import_seconds: int = 1800
    max_render_seconds: int = 3600

    # Force simulation even when weights are present — used by CI so the test
    # suite exercises the pipeline shape without a GPU.
    force_simulation: bool = False

    @property
    def has_ffmpeg(self) -> bool:
        return shutil.which("ffmpeg") is not None

    @property
    def has_cuda(self) -> bool:
        try:
            import torch  # noqa: PLC0415

            return bool(torch.cuda.is_available())
        except Exception:
            # torch is an optional extra; absence means CPU, not an error.
            return False


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    settings = Settings()
    settings.work_dir.mkdir(parents=True, exist_ok=True)
    return settings
