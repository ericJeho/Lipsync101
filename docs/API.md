# API reference

Base URL: `https://api.lipsyncstudio.app/v1` (locally, `http://localhost:4000/v1`)

## Authentication

Two schemes.

**Browser sessions** use a short-lived bearer token plus an httpOnly refresh
cookie. `POST /auth/refresh` rotates both; the old refresh token is revoked on
use, so a stolen one stops working as soon as the real client refreshes.

**Server-to-server** uses an API key on the `X-API-Key` header. Keys are shown
once at creation and stored only as a SHA-256 hash. Studio plan and above.

```http
X-API-Key: lss_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

## Errors

Always the same envelope:

```json
{
  "error": {
    "code": "plan_limit",
    "message": "This render costs 240 credits and you have 96.",
    "details": { "required": 240, "available": 96 }
  }
}
```

| Status | Code | Meaning |
| --- | --- | --- |
| 400 | `bad_request` | Malformed request |
| 401 | `unauthorized` / `token_expired` | Missing, invalid or expired credential |
| 402 | `plan_limit` | Valid request the plan does not permit — `details` carries the limit and the actual value |
| 403 | `forbidden` | Authenticated but not allowed |
| 404 | `not_found` | Also returned for resources you do not own, so ids cannot be probed |
| 409 | `conflict` | State conflict, e.g. cancelling a finished render |
| 422 | `validation_failed` | `details` is `{ "field.path": "message" }` |
| 429 | `rate_limited` | Back off; `RateLimit` headers say when |
| 503 | `service_unavailable` | Inference service unreachable — credits are not charged |

## Rate limits

Keyed by account when authenticated, IP otherwise.

| Scope | Limit |
| --- | --- |
| Global | 120 / minute |
| Credentials (`login`, `register`) | 10 / 15 minutes |
| Password reset | 5 / hour |
| Render submission | 20 / minute |
| Uploads | 60 / minute |

---

## Uploading

Two steps. The bytes never transit the API.

### `POST /assets/uploads`

```json
{
  "filename": "presenter.mp4",
  "contentType": "video/mp4",
  "sizeBytes": 18432000,
  "kind": "video"
}
```

```json
{
  "asset": { "id": "…", "status": "uploading" },
  "upload": {
    "url": "https://bucket.r2.cloudflarestorage.com/…",
    "method": "PUT",
    "headers": { "content-type": "video/mp4" },
    "expiresInSeconds": 3600
  }
}
```

PUT the file to `upload.url` with `upload.headers`, then:

### `POST /assets/:id/complete`

Probes the media, runs the malware scan, runs moderation and detects faces.
Returns `422` with a plain explanation if the clip has no visible face, the
format is unreadable, or the content breaches policy.

### Other asset endpoints

| | |
| --- | --- |
| `POST /assets/:id/analyze` | Voice analysis with confidence scores |
| `POST /assets/:id/extract-audio` | Pull the audio track into a new asset |
| `POST /assets/import-url` | Import audio from an allowlisted host |
| `GET /assets/:id/download` | Time-limited signed URL |
| `DELETE /assets/:id` | Refuses while an in-flight render references it |

---

## Rendering

### `POST /jobs`

```json
{
  "projectId": "uuid",
  "videoAssetId": "uuid",
  "audioAssetId": "uuid",
  "preset": "balanced",
  "engine": "musetalk",
  "outputFormat": "mp4",
  "outputHeight": 1080,
  "enhancements": ["faceRestore", "colorCorrect"],
  "expression": {
    "mouthIntensity": 74, "smile": 52, "eyeBlink": 50,
    "expressionStrength": 60, "headMovement": 50, "emotionIntensity": 55
  },
  "musicMode": false,
  "karaokeTiming": false,
  "translateTo": "ny",
  "subtitles": { "enabled": true, "burnIn": false, "languages": ["en", "ny"] },
  "notifyByEmail": true
}
```

Only `projectId`, `videoAssetId` and `audioAssetId` are required; everything
else has a sensible default.

Notes on behaviour that is easy to get wrong:

- **`engine` beats `preset`.** Omit it and the preset routes for you.
- **Resolution is clamped, not rejected.** A Free account asking for 4K gets
  720p and the quote says so. Clip length and monthly minutes are hard errors,
  because silently truncating someone's video would be worse.
- **The output is as long as the audio.** The video is looped or trimmed to fit.
- **Expression values are 0–100, centred on 50.** 50 means "leave the source
  alone".

Returns the job and the quote that was charged:

```json
{
  "job": { "id": "…", "status": "queued", "etaSeconds": 84 },
  "quote": { "engine": "musetalk", "credits": 96, "watermark": false }
}
```

### `POST /jobs/quote`

Prices a render without submitting it. Same maths, no charge.

### `GET /jobs/:id`

```json
{
  "job": {
    "status": "rendering",
    "progress": 62,
    "stage": "Synthesising lip motion",
    "etaSeconds": 31,
    "queuePosition": null,
    "outputUrl": null
  }
}
```

Poll this, or subscribe to the `job.completed` webhook, or open the realtime
socket. The webhook is the right answer for a server integration.

### `POST /jobs/:id/cancel`

Refunds in full if the render never reached a GPU. A render already consuming
cycles is cancelled but not refunded — the cycles were spent.

### Batch

`POST /jobs/batch` takes up to fifty jobs. Each is submitted independently, so
one bad clip does not sink the batch:

```json
{
  "batch": { "id": "…" },
  "jobs": [ … ],
  "failed": [{ "index": 3, "message": "We could not find a face in that video." }]
}
```

`POST /jobs/batch/:id/pause` removes queued jobs from the queue; anything
already on a GPU runs to completion.

---

## Subtitles

| | |
| --- | --- |
| `POST /subtitles/jobs/:id/generate` | Transcribe, translate, optionally align per word |
| `GET /subtitles/jobs/:id` | Fetch all tracks |
| `PUT /subtitles/jobs/:id` | Save edited cues — rejects overlapping or inverted cues with `422` |
| `GET /subtitles/jobs/:id/export?format=srt` | `srt`, `vtt` or `karaoke` |

Karaoke export uses WebVTT inline cue timings (`<00:00:01.250>word`), which
players honour natively — no custom renderer needed.

Ten languages: `en fr es zh ar pt hi ja sw ny`.

---

## Webhooks

Register at `POST /developer/webhooks`. HTTPS only, and public addresses only —
private-range hosts are refused, because an endpoint we POST to on your behalf
is otherwise an SSRF primitive.

Events: `job.queued`, `job.started`, `job.progress`, `job.completed`,
`job.failed`, `batch.completed`.

### Verifying a delivery

```http
X-LipSync-Event: job.completed
X-LipSync-Signature: t=1730900000,v1=8f3a…
```

The signature is HMAC-SHA256 over `<timestamp>.<raw body>`, using the secret
returned when you created the endpoint. Compare in constant time and reject
timestamps older than five minutes.

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

function verify(rawBody, header, secret) {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) return false;

  const expected = createHmac('sha256', secret)
    .update(`${parts.t}.${rawBody}`)
    .digest('hex');

  const a = Buffer.from(expected);
  const b = Buffer.from(parts.v1);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

Verify against the **raw body**, before any JSON parsing — re-serialising
changes the bytes and the signature will not match.

Endpoints that fail 20 times in a row are disabled automatically. A successful
delivery resets the counter.

---

## Realtime

Socket.IO at `/realtime`, authenticated with the access token:

```js
import { io } from 'socket.io-client';

const socket = io('https://api.lipsyncstudio.app', {
  path: '/realtime',
  auth: { token: accessToken },
});

socket.emit('job:subscribe', jobId);

socket.on('job:progress', ({ progress, stage, etaSeconds, queuePosition }) => {
  console.log(`${progress}% — ${stage}`);
});

socket.on('job:completed', ({ outputUrl }) => console.log(outputUrl));
socket.on('job:failed', ({ error, creditsRefunded }) => console.error(error));
```

Subscribing to a job you do not own is rejected.

---

## GraphQL

`POST /graphql` — a read-oriented surface over the same data.

```graphql
query {
  me { plan credits }
  jobs(take: 10, status: "completed") {
    total
    jobs { id engine outputUrl createdAt project { name } }
  }
}
```

Writes stay REST-only on purpose: rendering charges credits and enforces plan
limits, and having one place where that happens is worth more than symmetry.

Queries nested deeper than 8 levels are rejected before execution — the graph
shape otherwise lets a small query expand exponentially.

The SDL is served at `GET /graphql/schema` for codegen.

---

## SDK examples

Full working examples for cURL, JavaScript, Python, PHP and Flutter are on the
[`/developers`](https://lipsyncstudio.app/developers) page in the app, and in
`apps/web/src/app/developers/page.tsx`.

The shortest useful one:

```python
import os, time, requests

api = "https://api.lipsyncstudio.app/v1"
s = requests.Session()
s.headers["X-API-Key"] = os.environ["LIPSYNC_API_KEY"]

job = s.post(f"{api}/jobs", json={
    "projectId": project_id,
    "videoAssetId": video_id,
    "audioAssetId": audio_id,
    "preset": "balanced",
}).json()["job"]

while job["status"] not in ("completed", "failed", "cancelled"):
    time.sleep(5)
    job = s.get(f"{api}/jobs/{job['id']}").json()["job"]
    print(f"{job['progress']:>3}%  {job['stage']}")

print(job["outputUrl"])
```
