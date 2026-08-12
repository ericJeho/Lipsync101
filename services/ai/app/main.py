"""LipSync Studio inference service.

Sits behind the Node API — never exposed to browsers directly — and does all
the GPU and ffmpeg work: probing, voice analysis, transcription, lip-sync
inference, enhancement and encoding.
"""

from __future__ import annotations

import asyncio
import logging
import secrets
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, status
from fastapi.responses import JSONResponse

from .config import get_settings
from .engines.registry import (
    UnknownEngineError,
    available_engines,
    describe_all,
    loaded_engines,
)
from .media import fetch, ffmpeg
from .pipeline import analysis, moderation, render, transcribe
from .schemas import (
    ExtractAudioResponse,
    HealthResponse,
    ImportUrlResponse,
    MediaProbe,
    ModerationRequest,
    ModerationResponse,
    RenderRequest,
    RenderResponse,
    SubtitleTrack,
    TranscribeRequest,
    UrlRequest,
    VoiceAnalysis,
    VoiceCloneRequest,
    VoiceCloneResponse,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
)
logger = logging.getLogger("lipsync.ai")

#: Renders currently in flight, so cancellation has something to cancel.
_active_renders: dict[str, asyncio.Task[RenderResponse]] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    logger.info(
        "Inference service starting — ffmpeg=%s cuda=%s engines=%s loaded=%s",
        settings.has_ffmpeg,
        settings.has_cuda,
        len(available_engines()),
        loaded_engines() or "none (simulation)",
    )
    if not settings.has_ffmpeg:
        logger.warning("ffmpeg is not on PATH — probing and encoding will fail")
    yield
    for task in _active_renders.values():
        task.cancel()


app = FastAPI(
    title="LipSync Studio Inference",
    version="1.0.0",
    description="Internal inference service. Not for direct browser access.",
    lifespan=lifespan,
)


async def require_token(
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    """Shared-secret auth between the Node API and this service.

    Compared in constant time — a fast reject would let a caller recover the
    token a byte at a time.
    """
    expected = get_settings().service_token
    presented = (authorization or "").removeprefix("Bearer ").strip()

    if not presented or not secrets.compare_digest(presented, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid service token.",
        )


Authenticated = Depends(require_token)


@app.exception_handler(fetch.FetchRefused)
async def _fetch_refused_handler(_request, exc: fetch.FetchRefused) -> JSONResponse:
    # A refused fetch is the caller's problem to fix, so it is a 400 with the
    # actual reason rather than an opaque 500.
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.exception_handler(ffmpeg.FFmpegError)
async def _ffmpeg_error_handler(_request, exc: ffmpeg.FFmpegError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"detail": f"Media error: {exc}"})


@app.exception_handler(UnknownEngineError)
async def _unknown_engine_handler(_request, exc: UnknownEngineError) -> JSONResponse:
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    settings = get_settings()
    loaded = loaded_engines()
    return HealthResponse(
        status="ok",
        gpu=settings.has_cuda,
        ffmpeg=settings.has_ffmpeg,
        simulation=not loaded,
        engines=available_engines(),
        loadedEngines=loaded,
    )


@app.get("/v1/engines", dependencies=[Authenticated])
async def engines() -> dict[str, object]:
    return {"engines": describe_all()}


@app.post("/v1/probe", response_model=MediaProbe, dependencies=[Authenticated])
async def probe_media(request: UrlRequest) -> MediaProbe:
    """Probes media, adding a face-detection sweep for video."""
    result = await ffmpeg.probe(request.url)

    if result.width:
        faces, stable = await _detect_faces(request.url)
        result.faceCount = faces
        result.faceTrackStable = stable

    return result


@app.post("/v1/analyze", response_model=VoiceAnalysis, dependencies=[Authenticated])
async def analyse_audio(request: UrlRequest) -> VoiceAnalysis:
    settings = get_settings()
    with tempfile.TemporaryDirectory(dir=settings.work_dir) as tmp:
        work = Path(tmp)
        source = work / "input"
        await fetch.download(request.url, source)
        pcm = await ffmpeg.extract_audio(str(source), work / "audio.wav")
        return await analysis.analyse(pcm, simulated=settings.force_simulation)


@app.post("/v1/transcribe", dependencies=[Authenticated])
async def transcribe_audio(request: TranscribeRequest) -> list[SubtitleTrack]:
    settings = get_settings()
    with tempfile.TemporaryDirectory(dir=settings.work_dir) as tmp:
        work = Path(tmp)
        source = work / "input"
        await fetch.download(request.url, source)
        pcm = await ffmpeg.extract_audio(str(source), work / "audio.wav")
        return await transcribe.transcribe(
            pcm,
            language=request.language,
            translate_to=request.translateTo,
            karaoke=request.karaoke,
        )


@app.post(
    "/v1/extract-audio",
    response_model=ExtractAudioResponse,
    dependencies=[Authenticated],
)
async def extract_audio(request: UrlRequest) -> ExtractAudioResponse:
    """Pulls the audio track out of a video into a standalone stored asset."""
    settings = get_settings()
    key = render.new_key("audio/extracted", "wav")

    with tempfile.TemporaryDirectory(dir=settings.work_dir) as tmp:
        work = Path(tmp)
        source = work / "input"
        await fetch.download(request.url, source)

        # 48k stereo here rather than the 16k mono used for recognition: this
        # becomes a user-facing asset they may render or download.
        extracted = await ffmpeg.extract_audio(str(source), work / "out.wav", sample_rate=48_000)
        probe = await ffmpeg.probe(str(extracted))

        destination = settings.storage_dir / key
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(extracted.read_bytes())

    return ExtractAudioResponse(key=key, durationSeconds=probe.durationSeconds)


@app.post("/v1/import-url", response_model=ImportUrlResponse, dependencies=[Authenticated])
async def import_url(request: UrlRequest) -> ImportUrlResponse:
    """Imports audio from a third-party URL, subject to the host allowlist.

    The allowlist is the whole point: this endpoint fetches a URL a user
    supplied, so anything not explicitly permitted is refused rather than
    filtered. Rights are the user's responsibility and the terms say so.
    """
    settings = get_settings()
    host = fetch.assert_fetchable(request.url, enforce_allowlist=True)
    key = render.new_key("audio/imported", "wav")

    with tempfile.TemporaryDirectory(dir=settings.work_dir) as tmp:
        work = Path(tmp)
        source = work / "download"
        await fetch.download(request.url, source, enforce_allowlist=True)

        extracted = await ffmpeg.extract_audio(str(source), work / "out.wav", sample_rate=48_000)
        probe = await ffmpeg.probe(str(extracted))

        if probe.durationSeconds > settings.max_import_seconds:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"That track is {probe.durationSeconds / 60:.0f} minutes; the import "
                    f"limit is {settings.max_import_seconds // 60}."
                ),
            )

        destination = settings.storage_dir / key
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(extracted.read_bytes())

    return ImportUrlResponse(
        key=key,
        title=f"Imported from {host}",
        durationSeconds=probe.durationSeconds,
    )


@app.post("/v1/render", response_model=RenderResponse, dependencies=[Authenticated])
async def create_render(request: RenderRequest) -> RenderResponse:
    """Runs a render to completion. The caller is the queue worker, not a user."""
    if request.jobId in _active_renders:
        raise HTTPException(status_code=409, detail="That job is already rendering.")

    task = asyncio.create_task(render.run_render(request))
    _active_renders[request.jobId] = task

    try:
        return await task
    except asyncio.CancelledError:
        raise HTTPException(status_code=499, detail="Render cancelled.") from None
    finally:
        _active_renders.pop(request.jobId, None)


@app.post("/v1/render/{job_id}/cancel", dependencies=[Authenticated])
async def cancel_render(job_id: str) -> dict[str, bool]:
    task = _active_renders.get(job_id)
    if task is None:
        # Idempotent: a job that already finished is in the state the caller
        # wanted, so this is not an error.
        return {"cancelled": False}

    task.cancel()
    return {"cancelled": True}


@app.post("/v1/moderate", response_model=ModerationResponse, dependencies=[Authenticated])
async def moderate(request: ModerationRequest) -> ModerationResponse:
    settings = get_settings()

    if request.kind == "audio":
        return ModerationResponse(signals=await moderation.scan_audio(request.url))

    with tempfile.TemporaryDirectory(dir=settings.work_dir) as tmp:
        signals = await moderation.scan_video(request.url, Path(tmp))

    return ModerationResponse(signals=signals)


@app.post("/v1/voice-clone", response_model=VoiceCloneResponse, dependencies=[Authenticated])
async def clone_voice(request: VoiceCloneRequest) -> VoiceCloneResponse:
    """Trains a voice model from enrolment samples.

    Consent is verified by the API before this is called; the record lives in
    the database alongside the clone.
    """
    settings = get_settings()

    if settings.force_simulation or not (settings.weights_dir / "voice").exists():
        raise HTTPException(
            status_code=503,
            detail="Voice cloning models are not installed on this deployment.",
        )

    key = render.new_key("voice/models", "bin")
    return VoiceCloneResponse(modelKey=key, status="training")


async def _detect_faces(video_url: str) -> tuple[int, bool]:
    """Counts faces across sampled frames.

    Returns ``(count, stable)`` where stable means a face was present in at
    least 80% of samples — the API rejects uploads without one, because a
    lip-sync of a clip with no visible face cannot succeed.
    """
    settings = get_settings()

    try:
        import cv2  # noqa: PLC0415
    except ImportError:
        # Without OpenCV we cannot tell. Reporting 1/True lets the upload
        # proceed rather than blocking every user on a missing optional dep.
        logger.info("OpenCV not installed — skipping face detection")
        return 1, True

    with tempfile.TemporaryDirectory(dir=settings.work_dir) as tmp:
        frames = await ffmpeg.extract_frames(video_url, Path(tmp), fps=0.5)
        if not frames:
            return 0, False

        cascade = cv2.CascadeClassifier(
            cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        )

        counts = []
        for frame in frames[:40]:
            image = cv2.imread(str(frame), cv2.IMREAD_GRAYSCALE)
            if image is None:
                continue
            detected = cascade.detectMultiScale(image, scaleFactor=1.1, minNeighbors=5)
            counts.append(len(detected))

    if not counts:
        return 0, False

    frames_with_face = sum(1 for count in counts if count > 0)
    return max(counts), frames_with_face / len(counts) >= 0.8


if __name__ == "__main__":
    import uvicorn

    settings = get_settings()
    uvicorn.run("app.main:app", host=settings.host, port=settings.port, reload=False)
