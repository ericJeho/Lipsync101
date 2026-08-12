"""Engine lookup and preset resolution."""

from __future__ import annotations

from functools import lru_cache

from ..config import get_settings
from .adapters import ALL_ENGINE_CLASSES
from .base import LipSyncEngine

# Mirrors `defaultFor` in packages/shared/src/models.ts. Kept as a plain map so
# a mismatch between the two is a one-line fix rather than a code change.
PRESET_DEFAULTS: dict[str, str] = {
    "fast": "wav2lip",
    "balanced": "musetalk",
    "highest": "videoretalking",
}


class UnknownEngineError(KeyError):
    """Raised for an engine id the service does not implement."""


@lru_cache(maxsize=1)
def _registry() -> dict[str, LipSyncEngine]:
    settings = get_settings()
    return {
        cls.id: cls(settings.weights_dir, settings.force_simulation)
        for cls in ALL_ENGINE_CLASSES
    }


def available_engines() -> list[str]:
    return list(_registry().keys())


def loaded_engines() -> list[str]:
    """Engines with real weights on disk, as opposed to simulated ones."""
    return [engine_id for engine_id, engine in _registry().items() if not engine.simulated]


def get_engine(engine_id: str) -> LipSyncEngine:
    try:
        return _registry()[engine_id]
    except KeyError:
        raise UnknownEngineError(
            f"Unknown engine '{engine_id}'. Available: {', '.join(available_engines())}"
        ) from None


def resolve_engine(engine_id: str | None, preset: str, music_mode: bool = False) -> LipSyncEngine:
    """Picks the engine to use, substituting when the request is incompatible.

    A music job routed to an engine that cannot sing would produce a technically
    successful render that is visibly wrong, so we substitute a capable engine
    rather than failing or proceeding.
    """
    chosen = engine_id or PRESET_DEFAULTS.get(preset, "musetalk")
    engine = get_engine(chosen)

    if music_mode and not engine.supports_music:
        return get_engine(PRESET_DEFAULTS["balanced"])

    return engine


def describe_all() -> list[dict[str, object]]:
    return [engine.describe() for engine in _registry().values()]
