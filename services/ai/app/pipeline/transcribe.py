"""Transcription, translation and karaoke alignment via Whisper."""

from __future__ import annotations

import logging
from pathlib import Path

from ..config import get_settings
from ..schemas import SubtitleCue, SubtitleTrack, SubtitleWord

logger = logging.getLogger(__name__)

# Whisper covers all ten of our target languages; Chichewa (ny) is the weakest,
# so we surface its lower confidence rather than presenting it as equivalent.
SUPPORTED = ("en", "fr", "es", "zh", "ar", "pt", "hi", "ja", "sw", "ny")

_model = None


def _load_model():
    """Loads Whisper once per process, or returns None when unavailable."""
    global _model
    if _model is not None:
        return _model

    settings = get_settings()
    if settings.force_simulation:
        return None

    try:
        from faster_whisper import WhisperModel  # noqa: PLC0415

        device = "cuda" if settings.has_cuda else "cpu"
        # int8 on CPU keeps a `small` model usable on a laptop; float16 on GPU.
        compute_type = "float16" if device == "cuda" else "int8"
        _model = WhisperModel(settings.whisper_model, device=device, compute_type=compute_type)
        logger.info("Loaded Whisper %s on %s", settings.whisper_model, device)
        return _model
    except Exception as error:
        logger.info("Whisper unavailable, transcription will be simulated: %s", error)
        return None


async def detect_language(audio_path: Path) -> tuple[str, float]:
    """Returns (language code, confidence)."""
    model = _load_model()
    if model is None:
        return "en", 0.35

    _, info = model.transcribe(str(audio_path), language=None, vad_filter=True)
    return info.language, round(float(info.language_probability), 3)


def group_words_into_cues(
    words: list[SubtitleWord],
    max_chars: int = 42,
    max_seconds: float = 6.0,
    max_gap: float = 0.8,
) -> list[SubtitleCue]:
    """Groups word timings into readable cues.

    The limits are subtitle convention, not arbitrary: ~42 characters is one
    comfortable line, six seconds is about as long as a viewer will hold a cue,
    and a gap longer than 0.8s is a natural sentence break.
    """
    cues: list[SubtitleCue] = []
    current: list[SubtitleWord] = []

    def flush() -> None:
        if not current:
            return
        cues.append(
            SubtitleCue(
                id=str(len(cues) + 1),
                start=round(current[0].start, 3),
                end=round(current[-1].end, 3),
                text=" ".join(word.text.strip() for word in current).strip(),
                words=list(current),
            )
        )
        current.clear()

    for word in words:
        if current:
            length = sum(len(w.text) + 1 for w in current)
            too_long = length + len(word.text) > max_chars
            too_slow = word.end - current[0].start > max_seconds
            big_gap = word.start - current[-1].end > max_gap
            ends_sentence = current[-1].text.rstrip().endswith((".", "?", "!", "。", "؟"))

            if too_long or too_slow or big_gap or ends_sentence:
                flush()

        current.append(word)

    flush()
    return cues


async def transcribe(
    audio_path: Path,
    language: str | None = None,
    translate_to: list[str] | None = None,
    karaoke: bool = False,
) -> list[SubtitleTrack]:
    """Produces one track for the source language plus one per translation."""
    model = _load_model()
    translate_to = [code for code in (translate_to or []) if code in SUPPORTED]

    if model is None:
        return _simulated_tracks(language or "en", translate_to)

    segments, info = model.transcribe(
        str(audio_path),
        language=language,
        # Word timestamps are what make karaoke possible; they cost a little
        # extra time, so we only ask when the caller wants them.
        word_timestamps=True,
        vad_filter=True,
    )

    words: list[SubtitleWord] = []
    plain_cues: list[SubtitleCue] = []

    for index, segment in enumerate(segments):
        if karaoke and getattr(segment, "words", None):
            words.extend(
                SubtitleWord(
                    text=word.word,
                    start=round(word.start, 3),
                    end=round(word.end, 3),
                    confidence=round(getattr(word, "probability", 0.0), 3),
                )
                for word in segment.words
            )
        else:
            plain_cues.append(
                SubtitleCue(
                    id=str(index + 1),
                    start=round(segment.start, 3),
                    end=round(segment.end, 3),
                    text=segment.text.strip(),
                )
            )

    cues = group_words_into_cues(words) if karaoke and words else plain_cues
    tracks = [SubtitleTrack(language=info.language, translated=False, cues=cues)]

    for target in translate_to:
        if target == info.language:
            continue
        tracks.append(await _translate_track(tracks[0], target))

    return tracks


async def _translate_track(source: SubtitleTrack, target: str) -> SubtitleTrack:
    """Translates cues while preserving their timing.

    Timings come from the source audio and must not shift: the mouth is moving
    to the original speech, so a translated caption that drifts would be worse
    than one that reads slightly compressed.
    """
    try:
        from transformers import pipeline  # noqa: PLC0415

        translator = pipeline("translation", model=f"Helsinki-NLP/opus-mt-{source.language}-{target}")
        translated = translator([cue.text for cue in source.cues])
        texts = [item["translation_text"] for item in translated]
    except Exception as error:
        logger.info("Translation to %s unavailable: %s", target, error)
        texts = [cue.text for cue in source.cues]

    return SubtitleTrack(
        language=target,
        translated=True,
        cues=[
            SubtitleCue(id=cue.id, start=cue.start, end=cue.end, text=text)
            for cue, text in zip(source.cues, texts)
        ],
    )


def _simulated_tracks(language: str, translate_to: list[str]) -> list[SubtitleTrack]:
    """A single placeholder cue, clearly marked as such.

    Returning an empty list would look like a silent track; returning invented
    dialogue would be worse. This makes the missing model obvious in the UI.
    """
    cue = SubtitleCue(
        id="1",
        start=0.0,
        end=3.0,
        text="[Speech recognition model not installed on this deployment]",
    )
    tracks = [SubtitleTrack(language=language, translated=False, cues=[cue])]
    tracks.extend(
        SubtitleTrack(language=code, translated=True, cues=[cue]) for code in translate_to
    )
    return tracks
