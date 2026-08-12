"""Thin, safe wrappers around ffmpeg and ffprobe.

Every command is built as an argument list and run without a shell. The inputs
here are URLs and paths that originate with users, so string-interpolating them
into a shell command would be a command-injection hole.
"""

from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path

from ..config import get_settings
from ..schemas import MediaProbe

logger = logging.getLogger(__name__)


class FFmpegError(RuntimeError):
    """Raised when ffmpeg exits non-zero, carrying the tail of its stderr."""


async def _run(args: list[str], timeout: float = 600.0) -> tuple[bytes, bytes]:
    """Runs a command, returning (stdout, stderr) or raising FFmpegError."""
    process = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    try:
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        process.kill()
        await process.wait()
        raise FFmpegError(f"{args[0]} timed out after {timeout:.0f}s") from None

    if process.returncode != 0:
        # ffmpeg's stderr is verbose; the last lines carry the actual reason.
        tail = stderr.decode("utf-8", "replace").strip().splitlines()[-6:]
        raise FFmpegError("\n".join(tail) or f"{args[0]} exited {process.returncode}")

    return stdout, stderr


async def probe(source: str) -> MediaProbe:
    """Reads container and stream metadata with ffprobe."""
    stdout, _ = await _run(
        [
            "ffprobe",
            "-v", "error",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            source,
        ],
        timeout=120.0,
    )

    data = json.loads(stdout or b"{}")
    fmt = data.get("format", {})
    streams = data.get("streams", [])

    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)

    result = MediaProbe(
        durationSeconds=float(fmt.get("duration") or 0.0),
        bitrate=int(fmt["bit_rate"]) if fmt.get("bit_rate") else None,
    )

    if video:
        result.width = video.get("width")
        result.height = video.get("height")
        result.videoCodec = video.get("codec_name")
        result.fps = _parse_frame_rate(video.get("avg_frame_rate"))

    if audio:
        result.audioCodec = audio.get("codec_name")
        result.sampleRate = int(audio["sample_rate"]) if audio.get("sample_rate") else None
        result.channels = audio.get("channels")

    return result


def _parse_frame_rate(value: str | None) -> float | None:
    """ffprobe reports frame rate as a rational string like ``30000/1001``."""
    if not value or "/" not in value:
        return None
    numerator, _, denominator = value.partition("/")
    try:
        den = float(denominator)
        return round(float(numerator) / den, 3) if den else None
    except ValueError:
        return None


async def extract_audio(source: str, destination: Path, sample_rate: int = 16_000) -> Path:
    """Extracts a mono PCM track — the format every speech model expects."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    await _run(
        [
            "ffmpeg", "-y",
            "-i", source,
            "-vn",
            "-acodec", "pcm_s16le",
            "-ar", str(sample_rate),
            "-ac", "1",
            str(destination),
        ]
    )
    return destination


async def extract_frames(source: str, destination: Path, fps: float = 1.0) -> list[Path]:
    """Samples frames for face detection and moderation scanning."""
    destination.mkdir(parents=True, exist_ok=True)
    await _run(
        [
            "ffmpeg", "-y",
            "-i", source,
            "-vf", f"fps={fps}",
            "-q:v", "3",
            str(destination / "frame_%05d.jpg"),
        ]
    )
    return sorted(destination.glob("frame_*.jpg"))


async def thumbnail(source: str, destination: Path, at_seconds: float = 1.0) -> Path:
    """Grabs a single poster frame."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    await _run(
        [
            "ffmpeg", "-y",
            "-ss", str(at_seconds),
            "-i", source,
            "-frames:v", "1",
            "-q:v", "2",
            str(destination),
        ],
        timeout=120.0,
    )
    return destination


def build_encode_args(
    video_source: str,
    audio_source: str,
    destination: Path,
    output_format: str = "mp4",
    height: int = 1080,
    watermark_text: str | None = None,
    subtitle_path: Path | None = None,
) -> list[str]:
    """Builds the final mux/encode command.

    Separated from execution so the argument construction — the part with the
    interesting logic — is unit-testable without invoking ffmpeg.
    """
    filters: list[str] = [
        # -2 keeps width even, which h264 requires; scaling by height preserves
        # the source aspect ratio.
        f"scale=-2:{height}",
    ]

    if subtitle_path is not None:
        # Escaping matters: a colon or backslash in the path would otherwise be
        # read as filtergraph syntax.
        escaped = str(subtitle_path).replace("\\", "\\\\").replace(":", "\\:")
        filters.append(f"subtitles='{escaped}'")

    if watermark_text:
        safe_text = watermark_text.replace("'", "").replace(":", "")
        filters.append(
            f"drawtext=text='{safe_text}':fontcolor=white@0.75:fontsize=h/28:"
            "x=w-tw-h/40:y=h-th-h/40:box=1:boxcolor=black@0.35:boxborderw=8"
        )

    args = ["ffmpeg", "-y", "-i", video_source, "-i", audio_source]

    if output_format == "gif":
        # A shared palette avoids the dithered mush a naive GIF encode produces.
        args += [
            "-vf",
            ",".join([*filters, "fps=15", "split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse"]),
            "-loop", "0",
            str(destination),
        ]
        return args

    args += [
        "-vf", ",".join(filters),
        "-map", "0:v:0",
        "-map", "1:a:0",
        "-c:v", "libx264",
        "-preset", "medium",
        "-crf", "18",
        "-pix_fmt", "yuv420p",
        # Front-loading the moov atom lets a browser start playback before the
        # whole file has downloaded.
        "-movflags", "+faststart",
        "-c:a", "aac",
        "-b:a", "192k",
        # The output is as long as the audio; the video is looped or trimmed.
        "-shortest",
        str(destination),
    ]
    return args


async def encode(
    video_source: str,
    audio_source: str,
    destination: Path,
    output_format: str = "mp4",
    height: int = 1080,
    watermark_text: str | None = None,
    subtitle_path: Path | None = None,
) -> Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    args = build_encode_args(
        video_source,
        audio_source,
        destination,
        output_format,
        height,
        watermark_text,
        subtitle_path,
    )
    await _run(args, timeout=float(get_settings().max_render_seconds))
    return destination
