"""The interface every lip-sync engine implements."""

from __future__ import annotations

import abc
import asyncio
import logging
import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import Awaitable, Callable

from ..schemas import ExpressionControls

logger = logging.getLogger(__name__)

ProgressCallback = Callable[[float, str], Awaitable[None]]


@dataclass
class EngineContext:
    """Everything an adapter needs for one render."""

    job_id: str
    video_path: Path
    audio_path: Path
    output_path: Path
    work_dir: Path
    expression: ExpressionControls
    output_height: int = 1080
    music_mode: bool = False
    fps: float = 25.0
    duration_seconds: float = 0.0
    on_progress: ProgressCallback | None = None
    extra: dict[str, object] = field(default_factory=dict)

    async def report(self, fraction: float, stage: str) -> None:
        """Reports progress within this engine's slice of the pipeline."""
        if self.on_progress is not None:
            await self.on_progress(max(0.0, min(1.0, fraction)), stage)


class LipSyncEngine(abc.ABC):
    """Base adapter.

    Concrete engines supply ``weight_files`` and ``_infer``. The base class
    handles the parts that are identical everywhere: deciding whether real
    weights are present, and falling back to a simulated render when they are
    not so the whole pipeline stays exercisable without a GPU.
    """

    #: Registry key. Must match the id in ``packages/shared/src/models.ts``.
    id: str = ""
    name: str = ""

    #: Files that must exist under the weights directory for real inference.
    weight_files: tuple[str, ...] = ()

    #: Engines that synthesise pose rather than only repainting the mouth.
    synthesises_head_motion: bool = False
    supports_still_image: bool = False
    supports_music: bool = True

    def __init__(self, weights_dir: Path, force_simulation: bool = False) -> None:
        self.weights_dir = weights_dir
        self._force_simulation = force_simulation

    @property
    def weights_present(self) -> bool:
        if not self.weight_files:
            return False
        return all((self.weights_dir / name).exists() for name in self.weight_files)

    @property
    def simulated(self) -> bool:
        """True when this render will be simulated rather than inferred."""
        return self._force_simulation or not self.weights_present

    def missing_weights(self) -> list[str]:
        return [n for n in self.weight_files if not (self.weights_dir / n).exists()]

    async def run(self, context: EngineContext) -> Path:
        """Renders, dispatching to real inference or the simulation fallback."""
        if self.simulated:
            logger.info(
                "engine=%s running in simulation (missing weights: %s)",
                self.id,
                ", ".join(self.missing_weights()) or "forced",
            )
            return await self._simulate(context)

        return await self._infer(context)

    @abc.abstractmethod
    async def _infer(self, context: EngineContext) -> Path:
        """Real inference. Only called when ``weights_present``."""

    async def _simulate(self, context: EngineContext) -> Path:
        """Produces a valid output file without a model.

        This is not a mock in the testing sense — it emits a real, playable
        video with the requested audio muxed in, so every downstream stage
        (enhancement, subtitles, encoding, upload, the UI preview) runs against
        genuine media. Only the mouth motion is absent.
        """
        steps = ("Detecting faces", "Aligning phonemes", "Compositing mouth region")
        for index, stage in enumerate(steps):
            await context.report((index + 1) / (len(steps) + 1), stage)
            # A brief pause so progress reporting is observable end to end
            # rather than jumping straight to 100%.
            await asyncio.sleep(0.05)

        context.output_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(context.video_path, context.output_path)
        await context.report(1.0, "Compositing mouth region")
        return context.output_path

    def describe(self) -> dict[str, object]:
        return {
            "id": self.id,
            "name": self.name,
            "simulated": self.simulated,
            "missingWeights": self.missing_weights(),
            "headMotion": self.synthesises_head_motion,
            "stillImage": self.supports_still_image,
            "music": self.supports_music,
        }


def map_expression(expression: ExpressionControls) -> dict[str, float]:
    """Maps the UI's 0..100 sliders into engine-native ranges.

    The sliders are centred: 50 means "leave the source alone". Mapping to
    -1..1 around that centre keeps that meaning intact, while mouth intensity —
    which is a gain, not an offset — maps to 0..2 where 1 is neutral.
    """
    return {
        "mouth_gain": expression.mouthIntensity / 50.0,
        "smile_bias": (expression.smile - 50.0) / 50.0,
        "blink_rate": expression.eyeBlink / 50.0,
        "expression_scale": expression.expressionStrength / 50.0,
        "pose_scale": (expression.headMovement - 50.0) / 50.0,
        "emotion_scale": expression.emotionIntensity / 50.0,
    }
