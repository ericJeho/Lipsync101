"""Concrete engine adapters.

Each class wires one upstream model into the common ``LipSyncEngine``
interface. The bodies of ``_infer`` document the real call each project
expects and delegate to its inference entrypoint; without the corresponding
weights the base class routes to simulation instead, so this module imports
cleanly on a machine with no models installed.
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from .base import EngineContext, LipSyncEngine, map_expression

logger = logging.getLogger(__name__)


async def _run_inference(args: list[str], context: EngineContext, stage: str) -> None:
    """Runs a model's CLI entrypoint, streaming progress as it goes.

    The upstream projects are research code with their own dependency trees, so
    they run out-of-process rather than being imported: a version conflict in
    one model then cannot take the whole service down.
    """
    await context.report(0.05, stage)

    process = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )

    assert process.stdout is not None
    completed = 0.05

    async for raw in process.stdout:
        line = raw.decode("utf-8", "replace").strip()
        if not line:
            continue
        logger.debug("[%s] %s", context.job_id, line)
        # Most of these projects print a tqdm bar; nudging progress on each
        # line is a better signal than nothing, without parsing their format.
        completed = min(0.95, completed + 0.01)
        await context.report(completed, stage)

    if await process.wait() != 0:
        raise RuntimeError(f"{args[0]} exited with a non-zero status")

    await context.report(1.0, stage)


class Wav2LipEngine(LipSyncEngine):
    id = "wav2lip"
    name = "Wav2Lip"
    weight_files = ("wav2lip/wav2lip_gan.pth", "wav2lip/s3fd.pth")
    synthesises_head_motion = False

    async def _infer(self, context: EngineContext) -> Path:
        params = map_expression(context.expression)
        await _run_inference(
            [
                "python", "-m", "wav2lip.inference",
                "--checkpoint_path", str(self.weights_dir / "wav2lip/wav2lip_gan.pth"),
                "--face", str(context.video_path),
                "--audio", str(context.audio_path),
                "--outfile", str(context.output_path),
                # Wav2Lip's pads control how much chin is included in the crop;
                # a stronger mouth gain needs a taller box to avoid clipping.
                "--pads", "0", str(int(10 * params["mouth_gain"])), "0", "0",
                "--resize_factor", "1" if context.output_height >= 1080 else "2",
            ],
            context,
            "Synthesising lip motion",
        )
        return context.output_path


class MuseTalkEngine(LipSyncEngine):
    id = "musetalk"
    name = "MuseTalk"
    weight_files = ("musetalk/pytorch_model.bin", "musetalk/musetalk.json")

    async def _infer(self, context: EngineContext) -> Path:
        await _run_inference(
            [
                "python", "-m", "musetalk.inference",
                "--video_path", str(context.video_path),
                "--audio_path", str(context.audio_path),
                "--result_dir", str(context.work_dir),
                "--output", str(context.output_path),
                "--bbox_shift", str(int(map_expression(context.expression)["smile_bias"] * 10)),
                "--fps", str(context.fps),
            ],
            context,
            "Inpainting mouth region",
        )
        return context.output_path


class SadTalkerEngine(LipSyncEngine):
    id = "sadtalker"
    name = "SadTalker"
    weight_files = ("sadtalker/SadTalker_V0.0.2_512.safetensors", "sadtalker/mapping.pth")
    synthesises_head_motion = True
    supports_still_image = True
    supports_music = False

    async def _infer(self, context: EngineContext) -> Path:
        params = map_expression(context.expression)
        await _run_inference(
            [
                "python", "-m", "sadtalker.inference",
                "--source_image", str(context.video_path),
                "--driven_audio", str(context.audio_path),
                "--result_dir", str(context.work_dir),
                "--size", "512",
                # SadTalker invents pose, so the head-movement slider maps onto
                # its expression/pose scales directly rather than blending.
                "--expression_scale", f"{params['expression_scale']:.3f}",
                "--pose_style", str(max(0, min(45, int(20 + params["pose_scale"] * 20)))),
                "--still" if params["pose_scale"] < -0.6 else "--enhancer",
                "gfpgan",
            ],
            context,
            "Generating head motion",
        )
        return context.output_path


class VideoReTalkingEngine(LipSyncEngine):
    id = "videoretalking"
    name = "VideoReTalking"
    weight_files = (
        "videoretalking/DNet.pt",
        "videoretalking/LNet.pth",
        "videoretalking/ENet.pth",
    )

    async def _infer(self, context: EngineContext) -> Path:
        # Three stages, each roughly a third of the work — reported explicitly
        # so a four-minute render does not look stalled between them.
        for index, stage in enumerate(
            ("Neutralising expression", "Aligning to audio", "Restoring identity")
        ):
            await context.report(index / 3.0, stage)

        await _run_inference(
            [
                "python", "-m", "videoretalking.inference",
                "--face", str(context.video_path),
                "--audio", str(context.audio_path),
                "--outfile", str(context.output_path),
                "--exp_img", "neutral",
            ],
            context,
            "Restoring identity",
        )
        return context.output_path


class SyncTalkEngine(LipSyncEngine):
    id = "synctalk"
    name = "SyncTalk"
    weight_files = ("synctalk/ngp_kf.pth", "synctalk/audio_encoder.pth")
    synthesises_head_motion = True
    supports_music = False

    async def _infer(self, context: EngineContext) -> Path:
        await _run_inference(
            [
                "python", "-m", "synctalk.inference",
                "--pose", str(context.video_path),
                "--aud", str(context.audio_path),
                "--workspace", str(context.work_dir),
                "--output", str(context.output_path),
                "-O",
            ],
            context,
            "Rendering neural head model",
        )
        return context.output_path


class LivePortraitEngine(LipSyncEngine):
    id = "liveportrait"
    name = "LivePortrait"
    weight_files = (
        "liveportrait/appearance_feature_extractor.pth",
        "liveportrait/motion_extractor.pth",
        "liveportrait/stitching_retargeting_module.pth",
    )
    synthesises_head_motion = True
    supports_still_image = True

    async def _infer(self, context: EngineContext) -> Path:
        params = map_expression(context.expression)
        # LivePortrait is the one engine whose controls map one-to-one onto the
        # UI sliders, because its retargeting module exposes them individually.
        await _run_inference(
            [
                "python", "-m", "liveportrait.inference",
                "--source", str(context.video_path),
                "--driving", str(context.audio_path),
                "--output", str(context.output_path),
                "--lip_scale", f"{params['mouth_gain']:.3f}",
                "--eye_scale", f"{params['blink_rate']:.3f}",
                "--smile", f"{params['smile_bias']:.3f}",
                "--head_scale", f"{1.0 + params['pose_scale']:.3f}",
            ],
            context,
            "Retargeting keypoints",
        )
        return context.output_path


ALL_ENGINE_CLASSES: tuple[type[LipSyncEngine], ...] = (
    Wav2LipEngine,
    MuseTalkEngine,
    SadTalkerEngine,
    VideoReTalkingEngine,
    SyncTalkEngine,
    LivePortraitEngine,
)
