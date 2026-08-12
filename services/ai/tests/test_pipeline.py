"""Tests for the parts of the pipeline that hold real logic.

Nothing here needs a GPU, model weights or the network — the point is to cover
the decisions the service makes, which is where the bugs would be.
"""

from __future__ import annotations

import math
import wave
from pathlib import Path

import pytest

from app.engines.base import map_expression
from app.engines.registry import (
    PRESET_DEFAULTS,
    UnknownEngineError,
    available_engines,
    get_engine,
    resolve_engine,
)
from app.media import ffmpeg
from app.media.fetch import FetchRefused, assert_fetchable
from app.pipeline import analysis, enhance
from app.pipeline.render import STAGE_WEIGHTS, _srt_time
from app.pipeline.transcribe import group_words_into_cues
from app.schemas import ExpressionControls, SubtitleWord


# --------------------------------------------------------------------------
# Engine registry
# --------------------------------------------------------------------------


def test_all_six_engines_are_registered():
    assert sorted(available_engines()) == sorted(
        [
            "liveportrait",
            "musetalk",
            "sadtalker",
            "synctalk",
            "videoretalking",
            "wav2lip",
        ]
    )


def test_every_preset_resolves_to_a_real_engine():
    for preset, expected in PRESET_DEFAULTS.items():
        assert resolve_engine(None, preset).id == expected


def test_explicit_engine_beats_the_preset_default():
    assert resolve_engine("synctalk", "fast").id == "synctalk"


def test_music_job_substitutes_an_engine_that_can_sing():
    # SadTalker cannot handle singing, so a music job must not land on it.
    assert get_engine("sadtalker").supports_music is False
    chosen = resolve_engine("sadtalker", "balanced", music_mode=True)
    assert chosen.supports_music is True


def test_unknown_engine_names_the_alternatives():
    with pytest.raises(UnknownEngineError) as excinfo:
        get_engine("not-a-real-engine")
    assert "musetalk" in str(excinfo.value)


def test_engines_simulate_when_weights_are_absent(tmp_path):
    engine = get_engine("wav2lip")
    # No weights are checked into the repo, so every engine starts simulated.
    assert engine.simulated is True
    assert engine.missing_weights()


# --------------------------------------------------------------------------
# Expression mapping
# --------------------------------------------------------------------------


def test_neutral_sliders_map_to_neutral_parameters():
    params = map_expression(
        ExpressionControls(
            mouthIntensity=50,
            smile=50,
            eyeBlink=50,
            expressionStrength=50,
            headMovement=50,
            emotionIntensity=50,
        )
    )
    # Gains sit at 1.0, offsets at 0.0 — "leave the source alone".
    assert params["mouth_gain"] == pytest.approx(1.0)
    assert params["blink_rate"] == pytest.approx(1.0)
    assert params["smile_bias"] == pytest.approx(0.0)
    assert params["pose_scale"] == pytest.approx(0.0)


def test_slider_extremes_stay_within_engine_ranges():
    low = map_expression(ExpressionControls(mouthIntensity=0, smile=0, headMovement=0))
    high = map_expression(
        ExpressionControls(mouthIntensity=100, smile=100, headMovement=100)
    )
    assert low["mouth_gain"] == pytest.approx(0.0)
    assert high["mouth_gain"] == pytest.approx(2.0)
    assert low["smile_bias"] == pytest.approx(-1.0)
    assert high["smile_bias"] == pytest.approx(1.0)


# --------------------------------------------------------------------------
# SSRF guards on URL import
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "gopher://example.com/",
        "http://localhost:8000/admin",
        "http://127.0.0.1/",
        "http://169.254.169.254/latest/meta-data/",
        "http://10.0.0.5/internal",
    ],
)
def test_dangerous_urls_are_refused(url):
    with pytest.raises(FetchRefused):
        assert_fetchable(url, enforce_allowlist=False)


def test_public_host_passes_without_the_allowlist():
    assert assert_fetchable("https://example.com/audio.mp3", enforce_allowlist=False)


def test_allowlist_refuses_hosts_that_are_not_named():
    with pytest.raises(FetchRefused) as excinfo:
        assert_fetchable("https://example.com/audio.mp3", enforce_allowlist=True)
    assert "upload it directly" in str(excinfo.value)


# --------------------------------------------------------------------------
# ffmpeg command construction
# --------------------------------------------------------------------------


def test_encode_args_scale_to_even_width_and_faststart(tmp_path):
    args = ffmpeg.build_encode_args("in.mp4", "in.wav", tmp_path / "out.mp4", height=720)
    joined = " ".join(args)
    # -2 keeps the width even, which h264 requires.
    assert "scale=-2:720" in joined
    assert "+faststart" in joined
    assert "-shortest" in joined


def test_gif_output_builds_a_palette():
    args = ffmpeg.build_encode_args("in.mp4", "in.wav", Path("out.gif"), output_format="gif")
    joined = " ".join(args)
    assert "palettegen" in joined and "paletteuse" in joined
    # A GIF carries no audio track, so no audio codec should be requested.
    assert "-c:a" not in joined


def test_watermark_is_added_only_when_asked():
    without = ffmpeg.build_encode_args("i.mp4", "i.wav", Path("o.mp4"))
    with_mark = ffmpeg.build_encode_args(
        "i.mp4", "i.wav", Path("o.mp4"), watermark_text="LipSync Studio"
    )
    assert "drawtext" not in " ".join(without)
    assert "drawtext" in " ".join(with_mark)


def test_subtitle_path_is_escaped_for_the_filtergraph():
    args = ffmpeg.build_encode_args(
        "i.mp4", "i.wav", Path("o.mp4"), subtitle_path=Path("/tmp/a:b/subs.srt")
    )
    # An unescaped colon would be parsed as filtergraph syntax.
    assert "a\\:b" in " ".join(args)


def test_frame_rate_parsing_handles_ntsc_rationals():
    assert ffmpeg._parse_frame_rate("30000/1001") == pytest.approx(29.97, abs=0.01)
    assert ffmpeg._parse_frame_rate("25/1") == 25.0
    assert ffmpeg._parse_frame_rate("0/0") is None
    assert ffmpeg._parse_frame_rate(None) is None


# --------------------------------------------------------------------------
# Enhancement chain
# --------------------------------------------------------------------------


def test_enhancements_are_reordered_into_the_correct_sequence():
    # Requested in a deliberately wrong order.
    ordered = enhance.order_enhancements(["upscale", "denoise", "faceRestore"])
    assert ordered == ["faceRestore", "denoise", "upscale"]


def test_unknown_enhancements_are_dropped_not_passed_through():
    assert enhance.order_enhancements(["denoise", "make_it_pop"]) == ["denoise"]


def test_upscale_doubles_the_target_height():
    chain = enhance.build_filter_chain(["upscale"], output_height=720)
    assert "scale=-2:1440" in chain


def test_empty_enhancement_list_produces_no_filter():
    assert enhance.build_filter_chain([], 1080) is None


# --------------------------------------------------------------------------
# Subtitle grouping
# --------------------------------------------------------------------------


def _words(pairs):
    return [SubtitleWord(text=t, start=s, end=e) for t, s, e in pairs]


def test_words_are_grouped_into_readable_cues():
    words = _words([(f"word{i}", i * 0.3, i * 0.3 + 0.25) for i in range(30)])
    cues = group_words_into_cues(words, max_chars=42)
    assert len(cues) > 1
    for cue in cues:
        assert len(cue.text) <= 48  # allows for the final word crossing the limit
        assert cue.end > cue.start


def test_a_long_pause_starts_a_new_cue():
    words = _words([("hello", 0.0, 0.5), ("there", 0.6, 1.0), ("later", 5.0, 5.4)])
    cues = group_words_into_cues(words)
    assert len(cues) == 2
    assert cues[1].text == "later"


def test_sentence_end_starts_a_new_cue():
    words = _words([("Done.", 0.0, 0.5), ("Next", 0.6, 1.0)])
    cues = group_words_into_cues(words)
    assert len(cues) == 2


def test_cues_carry_their_word_timings_for_karaoke():
    words = _words([("hello", 0.0, 0.5), ("there", 0.6, 1.0)])
    cues = group_words_into_cues(words)
    assert cues[0].words is not None
    assert len(cues[0].words) == 2


# --------------------------------------------------------------------------
# Audio analysis
# --------------------------------------------------------------------------


def _write_wav(path: Path, frequency: float, seconds: float, rate: int = 16_000) -> Path:
    frames = bytearray()
    for index in range(int(rate * seconds)):
        value = int(20_000 * math.sin(2 * math.pi * frequency * index / rate))
        frames += int(value).to_bytes(2, "little", signed=True)

    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(bytes(frames))

    return path


def test_waveform_is_normalised_and_the_requested_length(tmp_path):
    _write_wav(tmp_path / "tone.wav", 220.0, 1.0)
    samples, rate = analysis._read_pcm(tmp_path / "tone.wav")
    waveform = analysis.compute_waveform(samples, buckets=100)

    assert len(waveform) == 100
    assert max(waveform) == pytest.approx(1.0, abs=0.001)
    assert min(waveform) >= 0.0


def test_waveform_of_silence_does_not_divide_by_zero():
    assert analysis.compute_waveform([], buckets=32) == [0.0] * 32
    assert analysis.compute_waveform([0.0] * 1000, buckets=16) == [0.0] * 16


def test_pitch_estimate_separates_a_low_voice_from_a_high_one(tmp_path):
    low = analysis._read_pcm(_write_wav(tmp_path / "low.wav", 110.0, 1.0))
    high = analysis._read_pcm(_write_wav(tmp_path / "high.wav", 220.0, 1.0))

    low_hz = analysis._estimate_pitch(*low)
    high_hz = analysis._estimate_pitch(*high)

    assert low_hz is not None and high_hz is not None
    assert low_hz == pytest.approx(110.0, rel=0.1)
    assert high_hz == pytest.approx(220.0, rel=0.1)


def test_tempo_needs_enough_onsets_to_be_credible():
    assert analysis.tempo_from_onsets([0.5, 1.0, 1.5]) is None

    even = [round(i * 0.5, 3) for i in range(20)]  # a clean 120 BPM grid
    result = analysis.tempo_from_onsets(even)
    assert result is not None
    bpm, confidence = result
    assert bpm == pytest.approx(120.0, abs=1.0)
    assert confidence > 0.9


def test_scattered_onsets_report_low_tempo_confidence():
    scattered = [0.0, 0.31, 0.92, 1.05, 1.9, 2.4, 2.45, 3.6, 4.9, 5.0]
    result = analysis.tempo_from_onsets(scattered)
    assert result is not None
    assert result[1] < 0.7


# --------------------------------------------------------------------------
# Render orchestration
# --------------------------------------------------------------------------


def test_stage_weights_sum_to_one():
    # If these drift the progress bar either stalls short of 100 or overshoots.
    assert sum(STAGE_WEIGHTS.values()) == pytest.approx(1.0)


def test_srt_timestamps_match_the_node_implementation():
    assert _srt_time(0) == "00:00:00,000"
    assert _srt_time(3661.5) == "01:01:01,500"
    assert _srt_time(-5) == "00:00:00,000"
