"""End-to-end render orchestration."""

from __future__ import annotations

import logging
import shutil
import tempfile
import uuid
from pathlib import Path

import httpx

from ..config import get_settings
from ..engines.base import EngineContext
from ..engines.registry import resolve_engine
from ..media import ffmpeg, fetch
from ..schemas import RenderRequest, RenderResponse, SubtitleTrack
from . import analysis, enhance, transcribe

logger = logging.getLogger(__name__)

# How the overall 0..100 progress splits across stages. Weights reflect real
# time spent, so the bar advances at a roughly constant rate.
STAGE_WEIGHTS = {
    "fetch": 0.05,
    "analyse": 0.08,
    "sync": 0.55,
    "enhance": 0.17,
    "subtitle": 0.05,
    "encode": 0.10,
}


class ProgressReporter:
    """Posts progress back to the Node API as the render advances."""

    def __init__(self, job_id: str, callback_url: str | None) -> None:
        self.job_id = job_id
        self.callback_url = callback_url
        self._completed = 0.0

    async def stage(self, name: str, fraction: float, label: str) -> None:
        """Reports `fraction` through the stage called `name`."""
        weight = STAGE_WEIGHTS.get(name, 0.0)
        overall = (self._completed + weight * max(0.0, min(1.0, fraction))) * 100.0
        await self._post(overall, label)

    def finish_stage(self, name: str) -> None:
        self._completed = min(1.0, self._completed + STAGE_WEIGHTS.get(name, 0.0))

    async def _post(self, progress: float, stage: str) -> None:
        if not self.callback_url:
            logger.debug("[%s] %.1f%% — %s", self.job_id, progress, stage)
            return
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                await client.post(
                    self.callback_url,
                    json={"progress": round(progress, 2), "stage": stage},
                )
        except Exception as error:
            # Losing a progress ping must never fail the render it describes.
            logger.debug("Progress callback failed: %s", error)


async def run_render(request: RenderRequest) -> RenderResponse:
    """Runs one render from source URLs to a finished, stored output file."""
    settings = get_settings()
    reporter = ProgressReporter(request.jobId, request.callbackUrl)

    work_dir = Path(tempfile.mkdtemp(prefix=f"lipsync-{request.jobId}-", dir=settings.work_dir))

    try:
        # --- fetch -------------------------------------------------------
        await reporter.stage("fetch", 0.1, "Downloading source media")
        video_path = work_dir / "source_video.mp4"
        audio_path = work_dir / "source_audio.wav"

        await fetch.download(request.videoUrl, video_path)
        await reporter.stage("fetch", 0.6, "Downloading source media")

        raw_audio = work_dir / "source_audio_raw"
        await fetch.download(request.audioUrl, raw_audio)
        # Normalise to mono 16k PCM up front: every downstream stage — the
        # engine, Whisper, the analyser — wants that same format.
        await ffmpeg.extract_audio(str(raw_audio), audio_path)
        reporter.finish_stage("fetch")

        probe = await ffmpeg.probe(str(video_path))
        audio_probe = await ffmpeg.probe(str(audio_path))
        duration = audio_probe.durationSeconds or probe.durationSeconds

        # --- analyse -----------------------------------------------------
        await reporter.stage("analyse", 0.3, "Analysing voice")
        engine = resolve_engine(request.engine, request.preset, request.musicMode)
        voice = await analysis.analyse(audio_path, simulated=engine.simulated)
        reporter.finish_stage("analyse")

        # --- lip sync ----------------------------------------------------
        synced_path = work_dir / "synced.mp4"

        async def on_engine_progress(fraction: float, stage: str) -> None:
            await reporter.stage("sync", fraction, stage)

        context = EngineContext(
            job_id=request.jobId,
            video_path=video_path,
            audio_path=audio_path,
            output_path=synced_path,
            work_dir=work_dir,
            expression=request.expression,
            output_height=request.outputHeight,
            music_mode=request.musicMode,
            fps=probe.fps or 25.0,
            duration_seconds=duration,
            on_progress=on_engine_progress,
        )

        await engine.run(context)
        reporter.finish_stage("sync")

        # --- enhance -----------------------------------------------------
        enhanced_path = synced_path
        if request.enhancements:
            await reporter.stage("enhance", 0.2, "Enhancing faces")
            enhanced_path = await enhance.apply(
                synced_path,
                work_dir / "enhanced.mp4",
                request.enhancements,
                request.outputHeight,
                weights_dir=settings.weights_dir,
            )
        reporter.finish_stage("enhance")

        # --- subtitles ---------------------------------------------------
        subtitles: list[SubtitleTrack] = []
        subtitle_file: Path | None = None

        if request.subtitleLanguages:
            await reporter.stage("subtitle", 0.3, "Generating subtitles")
            subtitles = await transcribe.transcribe(
                audio_path,
                language=None,
                translate_to=request.subtitleLanguages,
                karaoke=request.karaokeTiming,
            )
            if request.burnInSubtitles and subtitles:
                subtitle_file = _write_srt(subtitles[0], work_dir / "burn.srt")
        reporter.finish_stage("subtitle")

        # --- encode ------------------------------------------------------
        await reporter.stage("encode", 0.2, "Encoding output")
        output_name = f"{request.jobId}.{request.outputFormat}"
        output_path = work_dir / output_name

        await ffmpeg.encode(
            str(enhanced_path),
            str(audio_path),
            output_path,
            output_format=request.outputFormat,
            height=request.outputHeight,
            watermark_text="LipSync Studio" if request.watermark else None,
            subtitle_path=subtitle_file,
        )

        thumbnail_path = work_dir / f"{request.jobId}.jpg"
        try:
            await ffmpeg.thumbnail(str(output_path), thumbnail_path, at_seconds=min(1.0, duration / 2))
        except ffmpeg.FFmpegError as error:
            logger.warning("Thumbnail generation failed: %s", error)
            thumbnail_path = None  # type: ignore[assignment]

        output_key = _publish(output_path, f"render/{request.jobId}/{output_name}")
        thumbnail_key = (
            _publish(thumbnail_path, f"render/{request.jobId}/poster.jpg")
            if thumbnail_path
            else None
        )
        reporter.finish_stage("encode")
        await reporter.stage("encode", 1.0, "Done")

        return RenderResponse(
            jobId=request.jobId,
            outputKey=output_key,
            thumbnailKey=thumbnail_key,
            durationSeconds=round(duration, 3),
            analysis=voice,
            subtitles=subtitles,
        )

    finally:
        # Renders write multi-gigabyte intermediates; leaving them behind fills
        # the worker's disk within a few jobs.
        shutil.rmtree(work_dir, ignore_errors=True)


def _publish(path: Path, key: str) -> str:
    """Moves a finished artefact into the shared storage root."""
    settings = get_settings()
    destination = settings.storage_dir / key
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(path, destination)
    return key


def _write_srt(track: SubtitleTrack, destination: Path) -> Path:
    """Writes an SRT for burn-in. Mirrors ``toSrt`` in the Node API."""
    lines: list[str] = []
    for index, cue in enumerate(track.cues, start=1):
        lines.append(str(index))
        lines.append(f"{_srt_time(cue.start)} --> {_srt_time(cue.end)}")
        lines.append(cue.text)
        lines.append("")

    destination.write_text("\n".join(lines), encoding="utf-8")
    return destination


def _srt_time(seconds: float) -> str:
    clamped = max(0.0, seconds)
    hours, remainder = divmod(int(clamped), 3600)
    minutes, secs = divmod(remainder, 60)
    millis = int(round((clamped - int(clamped)) * 1000))
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def new_key(prefix: str, extension: str) -> str:
    return f"{prefix}/{uuid.uuid4()}.{extension}"
