"""Post-render enhancement chain.

Each enhancement is one ffmpeg filter or one model pass. They are applied in a
fixed order because the order changes the result: restoring the face before
denoising keeps detail that denoising would otherwise remove permanently, and
upscaling last means every earlier pass runs at the cheaper resolution.
"""

from __future__ import annotations

import logging
from pathlib import Path

from ..media import ffmpeg

logger = logging.getLogger(__name__)

# The order enhancements are applied in, regardless of the order requested.
ENHANCEMENT_ORDER = (
    "faceRestore",
    "denoise",
    "skinSmooth",
    "colorCorrect",
    "relight",
    "stabilize",
    "upscale",
)

#: Enhancements expressible as a plain ffmpeg filter, with no model needed.
FILTER_CHAIN: dict[str, str] = {
    # Temporal denoise: spatial luma/chroma kept low so grain structure
    # survives, temporal strength higher because that is where the noise is.
    "denoise": "hqdn3d=1.5:1.5:6:6",
    # Frequency-separated smoothing approximated with a light unsharp on the
    # low frequencies — blotches go, pores stay.
    "skinSmooth": "unsharp=5:5:-0.6:5:5:-0.3",
    "colorCorrect": "eq=contrast=1.04:brightness=0.01:saturation=1.06",
    "relight": "curves=preset=lighter,eq=gamma=1.05",
    # Two-pass stabilisation needs a detection run; the single-pass deshake is
    # the honest one-pass approximation.
    "stabilize": "deshake=rx=16:ry=16",
}


def order_enhancements(requested: list[str]) -> list[str]:
    """Sorts requested enhancements into the order they must be applied."""
    known = [name for name in ENHANCEMENT_ORDER if name in requested]
    unknown = [name for name in requested if name not in ENHANCEMENT_ORDER]
    if unknown:
        logger.warning("Ignoring unknown enhancements: %s", ", ".join(unknown))
    return known


def build_filter_chain(enhancements: list[str], output_height: int) -> str | None:
    """Builds the combined ffmpeg filter string, or None when nothing applies."""
    filters = [
        FILTER_CHAIN[name] for name in order_enhancements(enhancements) if name in FILTER_CHAIN
    ]

    if "upscale" in enhancements:
        # lanczos is the right resampler for upscaling detail; the model-based
        # path (Real-ESRGAN) replaces this when its weights are present.
        filters.append(f"scale=-2:{output_height * 2}:flags=lanczos")

    return ",".join(filters) if filters else None


async def apply(
    source: Path,
    destination: Path,
    enhancements: list[str],
    output_height: int,
    *,
    weights_dir: Path | None = None,
) -> Path:
    """Applies the enhancement chain, returning the path to the result."""
    ordered = order_enhancements(enhancements)
    if not ordered:
        return source

    current = source

    # Face restoration is a model pass, not a filter, so it runs first and on
    # its own before the filter chain touches the frames.
    if "faceRestore" in ordered and weights_dir and (weights_dir / "gfpgan/GFPGANv1.4.pth").exists():
        current = await _restore_faces(current, destination.with_suffix(".restored.mp4"), weights_dir)

    chain = build_filter_chain([e for e in ordered if e != "faceRestore"], output_height)
    if chain is None:
        return current

    destination.parent.mkdir(parents=True, exist_ok=True)
    await ffmpeg._run(
        [
            "ffmpeg", "-y",
            "-i", str(current),
            "-vf", chain,
            "-c:v", "libx264",
            "-preset", "medium",
            "-crf", "18",
            "-pix_fmt", "yuv420p",
            # Audio is untouched by every enhancement here, so re-encoding it
            # would only lose quality.
            "-c:a", "copy",
            str(destination),
        ],
        timeout=1800.0,
    )
    return destination


async def _restore_faces(source: Path, destination: Path, weights_dir: Path) -> Path:
    """Runs GFPGAN over the rendered frames."""
    import asyncio  # noqa: PLC0415

    process = await asyncio.create_subprocess_exec(
        "python", "-m", "gfpgan.inference",
        "--input", str(source),
        "--output", str(destination),
        "--version", "1.4",
        # Restoring only the detected face region avoids the plastic look a
        # whole-frame pass gives backgrounds.
        "--bg_upsampler", "none",
        "--model_path", str(weights_dir / "gfpgan/GFPGANv1.4.pth"),
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await process.communicate()

    if process.returncode != 0:
        # Enhancement is optional polish; failing the whole render because the
        # restorer choked would be the wrong trade.
        logger.warning("Face restoration failed, continuing unrestored: %s", stderr[-400:])
        return source

    return destination
