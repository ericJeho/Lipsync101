<div align="center">

# LipSync Studio

**Lip-sync any video to any voice, song or language — while keeping the expression, blinks and head motion from the original take.**

Next.js · Express · Python · PostgreSQL · Redis · FFmpeg · Docker

</div>

---

## What this is

A production-shaped platform for audio-driven facial reenactment. Upload a video
with a visible face and any audio track — speech, singing, or a machine
translation of the original — and it renders a version where the mouth matches
the phonemes and everything else is preserved.

Six lip-sync engines sit behind one interface, so the right model runs for the
footage rather than one model running for everything.

| Engine | Best at | Head motion | Sings | Cost |
| --- | --- | --- | --- | --- |
| **Wav2Lip** | Fast drafts, rock-solid sync | — | ✓ | 1.0× |
| **MuseTalk** | Real-time inpainting, identity preservation | — | ✓ | 1.2× |
| **SadTalker** | Animating a single still photo | ✓ | — | 2.4× |
| **VideoReTalking** | Highest quality on real footage | — | ✓ | 2.8× |
| **SyncTalk** | NeRF-grade identity across long renders | ✓ | — | 3.5× |
| **LivePortrait** | Per-feature control that maps to the sliders | ✓ | ✓ | 1.8× |

---

## Quick start

```bash
git clone https://github.com/ericJeho/Lipsync101.git
cd Lipsync101
npm install
```

### Frontend only

The studio runs standalone — uploads, the timeline, expression controls and a
simulated render all work without a backend. Good for UI work.

```bash
npm run dev:web        # http://localhost:3000
```

### Full stack

```bash
cp infra/.env.example infra/.env   # then fill in the secrets
npm run docker:up
```

| Service | URL |
| --- | --- |
| Web | http://localhost:3000 |
| API | http://localhost:4000 |
| Inference service | http://localhost:8000/docs |

Then seed some demo data:

```bash
npm run db:migrate
npm run db:seed        # creates admin / creator / free accounts
```

Sign in as `creator@lipsyncstudio.app` with the password printed by the seed.

### Deploying

Frontend on **Vercel**, backend on **Fly.io** — both configs are committed:

```bash
fly deploy --config infra/fly/fly.ai.toml services/ai    # inference service
fly deploy --config infra/fly/fly.api.toml .             # API + render worker
```

For Android, `.github/workflows/android.yml` builds the APK on every push and
uploads it as a run artifact — see [docs/ANDROID.md](docs/ANDROID.md).

`vercel.json` carries the monorepo build, so importing the repo and setting
`NEXT_PUBLIC_API_URL` is the whole frontend setup. The split is not arbitrary:
the API holds long-lived WebSockets and the worker runs minutes-long ffmpeg
jobs against a GPU, neither of which fits serverless. See
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#vercel).

### Without Docker

```bash
# 1. Postgres and Redis
docker run -d -p 5432:5432 -e POSTGRES_USER=lipsync -e POSTGRES_PASSWORD=lipsync \
  -e POSTGRES_DB=lipsync postgres:16-alpine
docker run -d -p 6379:6379 redis:7-alpine

# 2. Inference service
cd services/ai
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --port 8000

# 3. API, worker and web
cp .env.example .env
npm run db:migrate && npm run db:seed
npm run dev:api
npm run worker --workspace @lipsync/api
npm run dev:web
```

---

## Simulation mode

Model weights are not in this repository — they are multi-gigabyte files under
research and commercial licences that differ per engine.

Without them the inference service runs **simulated**: it downloads the real
media, runs the real ffmpeg pipeline, produces a real playable output file with
your audio muxed in, and reports honest low confidences from the analysers.
Only the mouth synthesis itself is absent.

That is deliberate. It means the entire pipeline — upload, probe, moderation,
analysis, enhancement, subtitles, encoding, storage, the queue, the progress
socket, the preview — is exercisable end to end on a laptop with no GPU, and it
is what CI runs against.

`GET /health` on the inference service reports which engines have real weights:

```json
{ "status": "ok", "gpu": false, "simulation": true, "loadedEngines": [] }
```

To load real engines, drop the weights under `services/ai/weights/<engine>/` and
restart. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#model-weights) for the
expected filenames and [docs/LICENSING.md](docs/LICENSING.md) for what each
licence permits — two of the six are **non-commercial**.

---

## Repository layout

```
├── apps/
│   ├── api/               Express API, Prisma schema, BullMQ render worker
│   ├── mobile/            Capacitor Android shell around the web studio
│   └── web/               Next.js App Router frontend
├── packages/
│   └── shared/            Types, Zod schemas, pricing and policy — the contract
├── services/
│   └── ai/                FastAPI inference service and engine adapters
├── infra/                 Dockerfiles, compose, nginx
└── docs/                  Architecture, API reference, deployment, licensing
```

`packages/shared` is the interesting one: engine capabilities, plan limits,
credit maths, moderation thresholds and job schemas live there, so the frontend,
the API and the worker cannot disagree about what a render costs or what the
rules are.

---

## Capabilities

**Input** — upload video and audio, record straight into the browser, extract
the audio from another clip, or import from an allowlisted URL.

**Analysis** — language, emotion, speaker gender, speaking rate, tempo and beat
grid, each with a confidence score the UI actually shows.

**Control** — six expression sliders (mouth intensity, smile, blinks, expression
strength, head movement, emotion) that map onto real engine parameters. 50 means
"leave the source alone".

**Enhancement** — face restoration, denoise, skin, colour, relight,
stabilisation and HD upscale, applied in a fixed order because the order changes
the result.

**Subtitles** — word-level timings, an editor that refuses overlapping cues, and
SRT / WebVTT / karaoke VTT export across ten languages including Swahili and
Chichewa.

**Editing** — a draggable timeline with split, trim, merge, replace-audio and
bounded undo/redo, plus a before/after player with a wipe handle and frame
stepping.

**Scale** — batch up to fifty clips with pause/resume/cancel, a priority queue,
live progress over WebSocket, and email on completion.

**Platform** — subscription plans, Stripe and PayPal alongside Airtel Money and
MTN Mobile Money, a REST API with signed webhooks, a GraphQL read surface, SDK
examples in four languages, and an admin console for users, payments, GPU jobs
and content review.

---

## Testing

```bash
npm test                                   # shared, api and web
cd services/ai && .venv/bin/python -m pytest
```

113 tests covering the parts where a bug would be expensive: the render
estimator and credit maths, plan entitlements, password policy, moderation
thresholds, auth guards, the GraphQL depth limiter, subtitle serialisation,
storage key handling, SSRF guards on URL import, ffmpeg argument construction,
the enhancement ordering, pitch and tempo estimation, and every timeline
operation including the undo stack.

---

## Responsible use

This tool puts words in people's mouths. That is genuinely useful for dubbing,
accessibility and localisation, and genuinely harmful in the wrong hands, so the
safeguards are part of the product:

- Uploads are scanned before they can be rendered, so a user learns a clip is
  unusable before spending credits on it.
- Voice cloning requires an explicit consent affirmation, stored with the
  timestamp and address that produced it.
- A recognisable face driven by audio with no consent record on file is routed
  to **human review** rather than silently blocked or silently allowed.
- Free renders carry a visible watermark.
- Files are deleted automatically on the plan's retention schedule.
- Moderation thresholds are per-category, because the cost of a false positive
  differs — blocking a wedding video for "violence" is worse than holding a
  suspected non-consensual deepfake for a human to look at.

Do not use this on faces or voices you do not have permission to use.

---

## Documentation

| | |
| --- | --- |
| [Architecture](docs/ARCHITECTURE.md) | How a render flows through the system |
| [API reference](docs/API.md) | REST, GraphQL, webhooks, SDK examples |
| [Deployment](docs/DEPLOYMENT.md) | Docker, Vercel, Fly.io, Supabase, GPU, scaling |
| [Android](docs/ANDROID.md) | Building and signing the APK |
| [Licensing](docs/LICENSING.md) | What each engine's licence permits |

## Licence

MIT for this codebase. The lip-sync models it integrates carry **their own
licences** — two of the six are non-commercial. Read
[docs/LICENSING.md](docs/LICENSING.md) before deploying commercially.
