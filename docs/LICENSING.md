# Licensing

This codebase is MIT. The models it integrates are not, and the differences
matter before you charge anyone money.

## The codebase

Everything in `apps/`, `packages/`, `services/ai/app/`, `infra/` and `docs/` is
MIT licensed. Use it however you like.

## The engines

**No model weights are distributed with this repository.** The adapters call
each project's inference entrypoint; you obtain and mount the weights yourself,
under whatever terms the upstream project sets.

| Engine | Licence | Commercial use |
| --- | --- | --- |
| **MuseTalk** | MIT | ✅ Yes |
| **LivePortrait** | MIT | ✅ Yes |
| **SadTalker** | Apache-2.0 | ✅ Yes |
| **VideoReTalking** | Apache-2.0 | ✅ Yes |
| **Wav2Lip** | Research / non-commercial | ❌ **No** |
| **SyncTalk** | Research / non-commercial | ❌ **No** |

Wav2Lip's weights are released for academic and research use. SyncTalk carries
similar research-only terms. Running either in a product you charge for needs a
separate agreement with the authors — the licence is not a formality you can
read past.

Because of that, the engine catalogue in
`packages/shared/src/models.ts` carries a `licence` field per engine, and the
value is surfaced in the UI rather than buried here.

### Running only the permissive engines

Mount weights for MuseTalk, LivePortrait, SadTalker and VideoReTalking, and
leave the other two absent. They stay in simulation and the rest of the product
is unaffected: MuseTalk is the `balanced` default and VideoReTalking is the
`highest` default, so the presets still resolve to real engines.

Only the `fast` preset defaults to Wav2Lip. If you are not licensed for it,
change `PRESET_DEFAULTS` in `services/ai/app/engines/registry.py` and
`defaultFor` in `packages/shared/src/models.ts` to point `fast` at MuseTalk.

## Supporting models

| Model | Used for | Licence |
| --- | --- | --- |
| Whisper / faster-whisper | Transcription, language ID | MIT |
| GFPGAN | Face restoration | Apache-2.0 |
| Real-ESRGAN | HD upscaling | BSD-3-Clause |
| Helsinki-NLP OPUS-MT | Subtitle translation | CC-BY-4.0 |
| Falconsai/nsfw_image_detection | Safety classification | Apache-2.0 |
| FFmpeg | Everything media | LGPL-2.1+ / GPL-2+ depending on build |

FFmpeg is worth a note: the standard builds in the Docker images are LGPL, which
is fine for dynamic use. A build configured with `--enable-gpl` (for x264 among
others) makes the binary GPL, which has implications if you redistribute it.
The images here invoke the system ffmpeg as a subprocess rather than linking
against it.

## Obligations you inherit

- **Attribution.** Apache-2.0 and BSD require the notices be preserved. Keep
  `NOTICE` files if you vendor any of these.
- **Translation output.** OPUS-MT is CC-BY, so attribution follows the
  translations it produces.
- **Non-commercial engines.** Do not enable Wav2Lip or SyncTalk in a paid
  product without permission from the authors.

## Content rights

Separate from software licensing, and just as real: users must hold the rights
to the faces, voices and audio they upload. The URL import endpoint enforces a
short host allowlist and the acceptable use policy says so explicitly, but the
obligation is theirs.

If you operate this service, you inherit the moderation duty that comes with it.
See the responsible-use section of the [README](../README.md#responsible-use).
