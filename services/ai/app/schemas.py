"""Request and response models.

These mirror the TypeScript types in ``packages/shared`` — the two are a
hand-maintained contract, so any change here needs the matching change there.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, HttpUrl

Engine = Literal[
    "wav2lip", "musetalk", "sadtalker", "videoretalking", "synctalk", "liveportrait"
]
Preset = Literal["fast", "balanced", "highest"]
Emotion = Literal["neutral", "happy", "sad", "angry", "excited", "calm", "fearful"]


class UrlRequest(BaseModel):
    url: str


class MediaProbe(BaseModel):
    durationSeconds: float = 0.0
    width: int | None = None
    height: int | None = None
    fps: float | None = None
    videoCodec: str | None = None
    audioCodec: str | None = None
    sampleRate: int | None = None
    channels: int | None = None
    bitrate: int | None = None
    faceCount: int | None = None
    faceTrackStable: bool | None = None


class Confidence(BaseModel):
    value: float | str
    confidence: float = Field(ge=0.0, le=1.0)


class VoiceAnalysis(BaseModel):
    language: Confidence
    emotion: Confidence
    gender: Confidence
    tempo: Confidence | None = None
    speakingRate: Confidence
    isMusic: bool = False
    beats: list[float] = Field(default_factory=list)
    durationSeconds: float = 0.0
    waveform: list[float] = Field(default_factory=list)


class SubtitleWord(BaseModel):
    text: str
    start: float
    end: float
    confidence: float | None = None


class SubtitleCue(BaseModel):
    id: str
    start: float
    end: float
    text: str
    words: list[SubtitleWord] | None = None
    speaker: str | None = None


class SubtitleTrack(BaseModel):
    language: str
    translated: bool = False
    cues: list[SubtitleCue] = Field(default_factory=list)


class TranscribeRequest(BaseModel):
    url: str
    language: str | None = None
    translateTo: list[str] = Field(default_factory=list)
    karaoke: bool = False


class ExpressionControls(BaseModel):
    """0..100 sliders as sent by the UI. 50 means "leave the source alone"."""

    mouthIntensity: float = 70
    smile: float = 50
    eyeBlink: float = 50
    expressionStrength: float = 55
    headMovement: float = 50
    emotionIntensity: float = 50


class RenderRequest(BaseModel):
    jobId: str
    videoUrl: str
    audioUrl: str
    engine: Engine = "musetalk"
    preset: Preset = "balanced"
    outputFormat: Literal["mp4", "mov", "gif"] = "mp4"
    outputHeight: int = 1080
    enhancements: list[str] = Field(default_factory=list)
    expression: ExpressionControls = Field(default_factory=ExpressionControls)
    musicMode: bool = False
    karaokeTiming: bool = False
    translateTo: str | None = None
    subtitleLanguages: list[str] = Field(default_factory=list)
    burnInSubtitles: bool = False
    watermark: bool = False
    callbackUrl: str | None = None


class RenderResponse(BaseModel):
    jobId: str
    outputKey: str
    thumbnailKey: str | None = None
    durationSeconds: float
    analysis: VoiceAnalysis | None = None
    subtitles: list[SubtitleTrack] = Field(default_factory=list)


class ModerationSignal(BaseModel):
    category: Literal[
        "nsfw", "nonconsensual_likeness", "violence", "copyright", "spam"
    ]
    score: float = Field(ge=0.0, le=1.0)
    detail: str | None = None


class ModerationRequest(BaseModel):
    url: str
    kind: Literal["video", "audio"] = "video"


class ModerationResponse(BaseModel):
    signals: list[ModerationSignal] = Field(default_factory=list)


class ExtractAudioResponse(BaseModel):
    key: str
    durationSeconds: float


class ImportUrlResponse(BaseModel):
    key: str
    title: str
    durationSeconds: float


class VoiceCloneRequest(BaseModel):
    samples: list[HttpUrl | str]
    name: str


class VoiceCloneResponse(BaseModel):
    modelKey: str
    status: Literal["training", "ready", "failed"]


class HealthResponse(BaseModel):
    status: str
    gpu: bool
    ffmpeg: bool
    simulation: bool
    engines: list[str]
    loadedEngines: list[str]
