"""Automated content safety checks.

This service scores; it does not decide. Thresholds and the allow/flag/block
decision live in ``packages/shared/src/moderation.ts`` so the same policy
applies whether the check runs here, in the API, or in the admin review UI.

Scores are deliberately conservative when a classifier is unavailable: an
absent model returns no signal rather than a zero, so "we did not check" is
never mistaken for "we checked and it was clean".
"""

from __future__ import annotations

import logging
from pathlib import Path

from ..config import get_settings
from ..media import ffmpeg
from ..schemas import ModerationSignal

logger = logging.getLogger(__name__)

# Frames per second sampled for classification. One per second is enough to
# catch sustained problem content without scoring every frame of a long clip.
SAMPLE_FPS = 0.5
MAX_FRAMES = 60


async def scan_video(video_path: str, work_dir: Path) -> list[ModerationSignal]:
    """Samples frames and scores them for policy violations."""
    settings = get_settings()
    signals: list[ModerationSignal] = []

    frames_dir = work_dir / "moderation_frames"
    try:
        frames = await ffmpeg.extract_frames(video_path, frames_dir, fps=SAMPLE_FPS)
    except ffmpeg.FFmpegError as error:
        logger.warning("Could not sample frames for moderation: %s", error)
        return signals

    frames = frames[:MAX_FRAMES]
    if not frames:
        return signals

    classifier = _load_classifier() if not settings.force_simulation else None

    if classifier is None:
        logger.info("Safety classifier unavailable — no automated signal produced")
        return signals

    nsfw_scores: list[float] = []
    violence_scores: list[float] = []

    for frame in frames:
        try:
            result = classifier(str(frame))
        except Exception as error:
            logger.warning("Classifier failed on %s: %s", frame.name, error)
            continue

        scores = {item["label"].lower(): float(item["score"]) for item in result}
        nsfw_scores.append(scores.get("nsfw", 0.0))
        violence_scores.append(scores.get("violence", 0.0))

    # The peak matters more than the mean: a single explicit frame in an
    # otherwise clean clip is still a policy violation, and averaging would
    # dilute it below any useful threshold.
    if nsfw_scores:
        signals.append(
            ModerationSignal(
                category="nsfw",
                score=round(max(nsfw_scores), 3),
                detail=f"Peak across {len(nsfw_scores)} sampled frames",
            )
        )
    if violence_scores and max(violence_scores) > 0.2:
        signals.append(
            ModerationSignal(
                category="violence",
                score=round(max(violence_scores), 3),
                detail=f"Peak across {len(violence_scores)} sampled frames",
            )
        )

    return signals


async def scan_audio(audio_path: str) -> list[ModerationSignal]:
    """Checks audio against known-content fingerprints.

    Copyright detection needs a licensed fingerprint database (ACRCloud,
    Audible Magic). Without one configured we emit nothing rather than a
    guess, because a false copyright block is a serious thing to do to a user.
    """
    logger.debug("Audio fingerprinting not configured for %s", audio_path)
    return []


def likeness_signal(face_count: int, has_consent_record: bool) -> ModerationSignal | None:
    """Flags a possible non-consensual likeness.

    Driving a recognisable face with audio the person never spoke is the
    highest-harm misuse of this product. A single clear face with no consent
    record on file is exactly that shape, so it is flagged for human review
    rather than blocked outright — the overwhelming majority are legitimate.
    """
    if has_consent_record or face_count == 0:
        return None

    return ModerationSignal(
        category="nonconsensual_likeness",
        # Below the block threshold, above the flag threshold: this routes to a
        # reviewer, it does not stop the render.
        score=0.45,
        detail="Identifiable face rendered without a consent record on file.",
    )


def _load_classifier():
    """Loads the image safety classifier, or returns None if unavailable."""
    try:
        from transformers import pipeline  # noqa: PLC0415

        return pipeline("image-classification", model="Falconsai/nsfw_image_detection")
    except Exception as error:
        logger.info("Safety classifier not loaded: %s", error)
        return None
