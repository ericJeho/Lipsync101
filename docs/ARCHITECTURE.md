# Architecture

## The shape of it

Three runtimes, chosen because each is genuinely better at its job than the
others would be:

- **Next.js / React** for the frontend — the studio is an interactive editor,
  and server components plus a client store is the right split for that.
- **Node / Express** for the API — I/O-bound work (auth, database, queueing,
  presigned URLs) where the event loop is an asset.
- **Python / FastAPI** for inference — every model in this space ships as
  Python, and reimplementing them elsewhere would be a losing project.

They talk over HTTP with typed contracts. `packages/shared` is the seam between
the two TypeScript runtimes; `services/ai/app/schemas.py` mirrors it for Python.

```
                         ┌──────────────┐
   browser ──────────────│    nginx     │
                         └──────┬───────┘
                    ┌───────────┴───────────┐
                    │                       │
              ┌─────▼─────┐          ┌──────▼──────┐
              │  Next.js  │          │  Express    │
              │   web     │          │    API      │
              └───────────┘          └──┬───┬───┬──┘
                                        │   │   │
                       ┌────────────────┘   │   └──────────────┐
                       │                    │                  │
                 ┌─────▼─────┐        ┌─────▼─────┐     ┌──────▼──────┐
                 │ PostgreSQL│        │   Redis   │     │   Object    │
                 │           │        │  BullMQ   │     │   storage   │
                 └───────────┘        └─────┬─────┘     └──────┬──────┘
                                            │                  │
                                     ┌──────▼──────┐           │
                                     │   Render    │───────────┘
                                     │   worker    │
                                     └──────┬──────┘
                                            │ HTTP
                                     ┌──────▼──────┐
                                     │   FastAPI   │
                                     │  inference  │──── GPU
                                     └─────────────┘
```

## Why the worker is a separate process

The API and the renderer have opposite profiles. The API wants many concurrent
short requests; a render occupies a GPU for minutes. Sharing a process means a
render starves request handling, and scaling one forces you to scale the other.

Splitting them lets the worker pool scale against queue depth while the API
scales against traffic, and lets a worker crash without taking the API down.
They run from the same image — the worker just overrides the command — so their
code and dependencies cannot drift.

Worker concurrency is deliberately **1**. Two renders sharing one GPU is slower
in aggregate than running them in series and risks CUDA OOM on the larger
models. Concurrency belongs at the container level.

## How a render flows

```
1.  POST /v1/assets/uploads        reserve a row, return a presigned URL
2.  PUT  <presigned>               browser → storage, never through the API
3.  POST /v1/assets/:id/complete   probe, virus scan, moderate, detect faces
4.  POST /v1/jobs                  price it, check the plan, debit, enqueue
5.  worker picks up                re-moderate, analyse voice
6.  POST ai:/v1/render             download, infer, enhance, subtitle, encode
7.  worker completes               store output, notify socket + webhook + email
```

### Where the money is handled

Credits are debited in `chargeForRender`, and the balance check lives **inside**
the `UPDATE`:

```ts
await prisma.user.updateMany({
  where: { id: userId, credits: { gte: credits } },
  data: { credits: { decrement: credits } },
});
```

A read-then-write check would let two renders submitted in the same instant both
pass. Everything after the charge is wrapped so that any failure refunds before
rethrowing, and the worker refunds on permanent failure — but only on the final
attempt, otherwise a transient CUDA error would refund and then re-run.

### Where moderation happens

Twice, on purpose.

At **upload**, so a user finds out a clip is unusable before spending credits on
it. At **render**, on the video/audio pair, because a face and an audio track are
only a deepfake risk *together* — neither is suspicious alone.

The inference service **scores**; it does not decide. Thresholds and the
allow/flag/block mapping live in `packages/shared/src/moderation.ts` so one
policy governs the API, the worker and the admin review queue. A missing
classifier emits **no signal** rather than a zero, so "not checked" is never
mistaken for "checked and clean".

## Data model notes

`apps/api/prisma/schema.prisma`, with a few deliberate choices:

- **UUID primary keys**, so the client can mint an id for optimistic UI.
- **Money in minor units** as integers. Floats and currency do not mix.
- **Everything user-uploaded hangs off `Asset`**, so the retention sweeper has
  exactly one table to walk.
- **Refresh tokens are stored hashed**, and rotated on every use. A database
  leak cannot be replayed, and a stolen token stops working the moment the real
  client refreshes.
- **`expiresAt` on every asset**, set from the owner's plan at upload time. The
  retention sweep is a scheduled job, not a promise in a policy document.

## Simulation mode

Every engine adapter inherits from `LipSyncEngine`, which checks for its weight
files and routes to `_simulate` when they are absent.

Simulation is not a stub. It emits a real, playable video with the requested
audio muxed in, so every downstream stage runs against genuine media: the
enhancement filters, the subtitle burn-in, the encode, the thumbnail, the upload
to storage, and the preview in the browser. Only the mouth synthesis is missing.

This is what makes the system developable. A frontend change can be verified end
to end on a laptop, and CI can exercise the whole pipeline without a GPU runner.

## Realtime

Socket.IO on `/realtime`, with rooms per user (`user:<id>`) and per job
(`job:<id>`). Joining a job room requires proving ownership first — without that
check, anyone could watch anyone else's render by guessing an id.

Progress is written to the database *and* pushed to the socket. The database is
the source of truth; the socket is an optimisation, so a client that missed an
event recovers on the next poll or page load.

## Storage

One `StorageDriver` interface with two implementations: local disk (the default,
so a fresh clone works with no cloud account) and an S3-compatible driver
covering AWS S3, Cloudflare R2, Google Cloud Storage's interoperability endpoint
and Azure via its S3 proxy. They differ only in endpoint and credentials.

SigV4 signing is implemented directly rather than pulled from the AWS SDK —
presigned PUT and GET are the only operations needed, and it keeps the API image
small.

Uploads are presigned so a 4GB video goes browser → bucket, never through the
API process. The local driver stands in with an authenticated proxy endpoint
that only accepts writes to a key the caller already reserved.

## Security posture

| Concern | Where it is handled |
| --- | --- |
| Password storage | Argon2id, ~64MB / 3 passes (`services/tokens.ts`) |
| Session theft | Hashed refresh tokens, rotated per use |
| Account enumeration | Identical responses on login and password reset |
| Brute force | 10 attempts / 15 min on credentials, keyed by account then IP |
| Path traversal | Filenames stripped; storage driver refuses keys outside its root |
| SSRF | Scheme + host allowlist, private-address rejection, manual redirect re-checks |
| Command injection | ffmpeg always invoked as an argv list, never a shell string |
| GraphQL abuse | Query depth ceiling before execution |
| Webhook forgery | HMAC-SHA256 over `<timestamp>.<raw body>`, constant-time compare, 5-minute window |
| IDOR | Every query scoped by `userId`; unknown ids return 404, not 403 |
| Secret leakage | Pino redaction; API keys stored only as hashes |

## What is deliberately not here

- **Model weights.** Multi-gigabyte, separately licensed, two of six
  non-commercial. See [LICENSING.md](LICENSING.md).
- **A payment provider integration that actually charges.** The checkout,
  webhook verification, settlement and plan application are all wired; the
  provider SDK call is the marked seam.
- **Audio fingerprinting for copyright.** That needs a licensed database
  (ACRCloud, Audible Magic). The hook is there and emits nothing rather than
  guessing, because a false copyright block is a serious thing to do to a user.
