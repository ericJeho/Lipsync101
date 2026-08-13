# Deployment

## Before you start

Three things need deciding: where media lives, whether you have a GPU, and which
engines you are licensed to run.

| Decision | Options | Default |
| --- | --- | --- |
| Storage | local disk, S3, R2, GCS, Azure | local disk |
| Inference | CPU (simulation), GPU (real) | CPU |
| Engines | see [LICENSING.md](LICENSING.md) | none — simulation |

---

## Docker Compose

The fastest real deployment. Suitable for a single box up to moderate volume.

```bash
cp infra/.env.example infra/.env
```

Fill in the secrets — compose **refuses to start** without them, which is
deliberate:

```bash
openssl rand -base64 48   # JWT_ACCESS_SECRET
openssl rand -base64 48   # JWT_REFRESH_SECRET
openssl rand -base64 32   # AI_SERVICE_TOKEN
openssl rand -base64 24   # POSTGRES_PASSWORD
```

```bash
docker compose -f infra/docker-compose.yml up -d
docker compose -f infra/docker-compose.yml exec api npx prisma migrate deploy
docker compose -f infra/docker-compose.yml exec api npm run db:seed   # optional
```

### Scaling the workers

Render throughput is worker count. Each worker takes one job at a time.

```bash
docker compose -f infra/docker-compose.yml up -d --scale worker=4
```

Watch queue depth at `GET /v1/admin/overview` and add workers while `waiting`
stays above zero for sustained periods.

---

## Vercel

Vercel hosts the **frontend only**. That is not a limitation of the config — the
API holds long-lived WebSockets for render progress, the worker runs ffmpeg for
minutes at a time against a GPU, and both want persistent processes. None of
that fits serverless. Put them on a container host and point the frontend at
them.

```
  Vercel                    Fly.io / Railway / Render        Cloud
  ┌──────────┐              ┌───────────┐  ┌──────────┐      ┌──────────┐
  │ Next.js  │──── HTTPS ──▶│    API    │  │  worker  │      │ Postgres │
  │   web    │◀── WSS ──────│           │  │    +     │      │  Redis   │
  └──────────┘              │           │  │    AI    │      │    S3    │
                            └───────────┘  └──────────┘      └──────────┘
```

### Connect the repository

`vercel.json` at the repository root already carries the build, so the only
thing to get right in the dashboard is the root directory.

1. **New Project** → import `ericJeho/Lipsync101`.
2. Leave **Root Directory** as the repository root — *not* `apps/web`. The web
   app imports `@lipsync/shared` through the npm workspace, which only resolves
   from the root.
3. Framework preset: **Next.js** (detected).
4. Leave build and install commands alone; `vercel.json` sets both:

   ```
   install   npm install --workspace @lipsync/web --workspace @lipsync/shared --include-workspace-root
   build     npm run build --workspace @lipsync/shared && npm run build --workspace @lipsync/web
   output    apps/web/.next
   ```

   The install is scoped on purpose. A plain `npm install` would also build
   `argon2` and generate the Prisma client for the API, which Vercel neither
   needs nor can use, and which is the usual cause of a first-build failure on
   this kind of monorepo.

### Environment variables

Set these in **Settings → Environment Variables** for Production and Preview.
`NEXT_PUBLIC_*` values are inlined into the client bundle at build time, so
changing one needs a redeploy, not just a restart.

| Variable | Example | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | `https://api.lipsyncstudio.app` | No trailing slash, no `/v1` |
| `NEXT_PUBLIC_SITE_URL` | `https://lipsyncstudio.app` | Canonical URL for SEO and OG tags |
| `NEXT_PUBLIC_WS_URL` | `https://api.lipsyncstudio.app` | Usually the same host as the API |

On the **API** side, set `WEB_URL` to the Vercel domain. It drives the CORS
allowlist and the OAuth callback, so a mismatch shows up as sign-in silently
failing in the browser with a CORS error in the console.

### Custom domain

**Settings → Domains → Add**, then point DNS at Vercel:

```
A      @      76.76.21.21
CNAME  www    cname.vercel-dns.com
```

Certificates are issued automatically. Put the API on a subdomain of the same
apex — `api.yourdomain.com` — so the refresh cookie stays same-site and you
avoid third-party cookie restrictions in Safari and Firefox.

### What runs where

| Component | Vercel | Why |
| --- | --- | --- |
| Next.js frontend | ✅ | Static and edge-rendered, exactly what it is for |
| Express API | ❌ | Long-lived WebSockets, background timers |
| Render worker | ❌ | Minutes-long ffmpeg and GPU work per job |
| Python inference | ❌ | Needs a GPU and multi-gigabyte model weights |
| Postgres / Redis | ❌ | Use Neon, Supabase, Upstash or the compose stack |

For the backend half, the same `infra/docker-compose.yml` runs unchanged on
Fly.io, Railway or Render — see the Docker Compose section above. Storage
should be R2 or S3 rather than the local driver, since containers there have
ephemeral disks.

### After the first deploy

- [ ] `NEXT_PUBLIC_API_URL` points at a reachable API (`curl $URL/health`)
- [ ] `WEB_URL` on the API matches the Vercel domain exactly
- [ ] Sign-in works end to end — the refresh cookie is the thing that breaks
      first when the domains are misconfigured
- [ ] The realtime socket connects; check the browser console on a render

---

## Fly.io

The backend half — API, render worker and the Python inference service. Fly
suits this well: persistent machines, a private network between apps, GPU
machines when you need them, and per-process scaling.

Two apps, plus managed data stores:

| App | Processes | Public |
| --- | --- | --- |
| `lipsync-api` | `api` (HTTP) + `worker` (queue consumer) | API only |
| `lipsync-ai` | inference service | No — private network only |

### First deploy

```bash
fly auth login

# Data stores. Postgres on Fly, Redis via Upstash — both reachable over the
# private network, so neither needs a public address.
fly postgres create --name lipsync-db --region iad
fly redis create --name lipsync-redis --region iad

# The apps. --no-deploy so we can set secrets before anything boots.
fly apps create lipsync-api
fly apps create lipsync-ai
fly postgres attach lipsync-db --app lipsync-api   # sets DATABASE_URL
```

Secrets — never in `fly.toml`, which is committed:

```bash
fly secrets set --app lipsync-api \
  JWT_ACCESS_SECRET="$(openssl rand -base64 48)" \
  JWT_REFRESH_SECRET="$(openssl rand -base64 48)" \
  AI_SERVICE_TOKEN="$(openssl rand -base64 32)" \
  REDIS_URL="redis://default:...@fly-lipsync-redis.upstash.io" \
  AI_SERVICE_URL="http://lipsync-ai.internal:8000" \
  API_URL="https://lipsync-api.fly.dev" \
  WEB_URL="https://your-vercel-domain.vercel.app" \
  STORAGE_BUCKET="lipsync-media" \
  STORAGE_ENDPOINT="https://<account>.r2.cloudflarestorage.com" \
  STORAGE_ACCESS_KEY="..." \
  STORAGE_SECRET_KEY="..." \
  STORAGE_PUBLIC_URL="https://media.yourdomain.com"

# The inference service needs the same shared token, and nothing else.
fly secrets set --app lipsync-ai AI_SERVICE_TOKEN="<the same value>"
```

Deploy. The API image builds from the workspace root, so the trailing `.`
matters — it is the build context:

```bash
fly deploy --config infra/fly/fly.ai.toml services/ai
fly deploy --config infra/fly/fly.api.toml .
```

The API's release command runs `prisma migrate deploy` before new machines take
traffic, so the schema is applied as part of the deploy rather than by hand.

### Three things that will bite you

**The worker must never scale to zero.** It has no HTTP service, so Fly's
proxy-driven autostart cannot wake it — nothing is listening to trigger on. A
worker scaled to zero means jobs queue forever with nothing consuming them, and
the symptom is renders stuck at "Queued" with a healthy-looking API. Both
process groups are pinned in `fly.api.toml`; keep them that way.

```bash
fly scale count api=2 worker=4 --app lipsync-api
```

**Storage has to be R2 or S3.** Fly machines have ephemeral disks and share
nothing between them. With the local driver, a user uploads to machine A and
then gets a download URL served by machine B, which does not have the file.
`STORAGE_DRIVER` is set to `r2` in `fly.api.toml` for that reason — it is not a
preference.

**Volumes are per-machine, not shared.** The same applies to model weights: a
volume attaches to one machine, so scaling the inference app past one machine
means one volume each.

### Scaling

Render throughput is worker count; each worker takes one job at a time. Watch
queue depth and add workers while `waiting` stays above zero:

```bash
fly ssh console --app lipsync-api -C "curl -s localhost:4000/health"
fly logs --app lipsync-api --instance worker
fly scale count worker=8 --app lipsync-api
```

The API scales on request volume instead, but rarely needs to — uploads are
presigned and bypass it, so what remains is small JSON.

### Connecting the two halves

Set `NEXT_PUBLIC_API_URL` on Vercel to the Fly API hostname, and `WEB_URL` on
Fly to the Vercel domain. They must agree exactly: `WEB_URL` drives the CORS
allowlist and the OAuth callback, and a mismatch shows up as sign-in failing
silently in the browser.

For a custom domain, put the API on a subdomain of the same apex as the
frontend so the refresh cookie stays same-site:

```bash
fly certs add api.yourdomain.com --app lipsync-api
```

Then set `API_URL=https://api.yourdomain.com` and point a CNAME at
`lipsync-api.fly.dev`.

---

## Model weights

Drop weights under `services/ai/weights/`. The service checks for these exact
paths at startup and reports what it found on `/health`.

```
services/ai/weights/
├── wav2lip/
│   ├── wav2lip_gan.pth
│   └── s3fd.pth
├── musetalk/
│   ├── pytorch_model.bin
│   └── musetalk.json
├── sadtalker/
│   ├── SadTalker_V0.0.2_512.safetensors
│   └── mapping.pth
├── videoretalking/
│   ├── DNet.pt
│   ├── LNet.pth
│   └── ENet.pth
├── synctalk/
│   ├── ngp_kf.pth
│   └── audio_encoder.pth
├── liveportrait/
│   ├── appearance_feature_extractor.pth
│   ├── motion_extractor.pth
│   └── stitching_retargeting_module.pth
└── gfpgan/
    └── GFPGANv1.4.pth        # optional, for face restoration
```

Any engine missing a file stays in simulation. That is per-engine, not global —
you can run MuseTalk for real while SyncTalk simulates.

Verify:

```bash
curl -s localhost:8000/health | jq
# { "simulation": false, "loadedEngines": ["musetalk", "wav2lip"], "gpu": true }
```

---

## GPU

Install the [NVIDIA container toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/),
then build the GPU target and uncomment the `deploy.resources` block in
`infra/docker-compose.yml`:

```bash
docker build --target gpu -t lipsync-ai:gpu services/ai
```

Sizing, per concurrent render at 1080p:

| Engine | VRAM | Approximate speed |
| --- | --- | --- |
| Wav2Lip | 4 GB | 0.35× realtime |
| MuseTalk | 6 GB | 0.5× realtime |
| LivePortrait | 8 GB | 1.1× realtime |
| SadTalker | 10 GB | 2.8× realtime |
| VideoReTalking | 12 GB | 3.4× realtime |
| SyncTalk | 16 GB | 4.2× realtime |

"0.35× realtime" means a 60-second clip takes about 21 seconds of GPU time. An
A10G (24GB) comfortably runs one worker of any engine.

---

## Cloud storage

Set the driver and credentials; nothing else changes. The API falls back to
local disk with a warning if a cloud driver is selected without credentials,
rather than failing to boot.

**Cloudflare R2** — no egress fees, which matters when you are serving video:

```bash
STORAGE_DRIVER=r2
STORAGE_BUCKET=lipsync-media
STORAGE_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
STORAGE_ACCESS_KEY=...
STORAGE_SECRET_KEY=...
STORAGE_PUBLIC_URL=https://media.yourdomain.com
```

**AWS S3**:

```bash
STORAGE_DRIVER=s3
STORAGE_REGION=eu-west-1
STORAGE_BUCKET=lipsync-media
STORAGE_ACCESS_KEY=...
STORAGE_SECRET_KEY=...
```

**Google Cloud Storage** uses the interoperability endpoint; **Azure Blob**
works through its S3 proxy. Both take the same shape with
`STORAGE_ENDPOINT` set.

### CORS

Browsers upload directly to the bucket, so it must permit that:

```json
[
  {
    "AllowedOrigins": ["https://yourdomain.com"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["content-type"],
    "ExposeHeaders": ["etag"],
    "MaxAgeSeconds": 3600
  }
]
```

---

## TLS and the reverse proxy

`infra/nginx.conf` is a complete config. The parts that are not boilerplate:

- `client_max_body_size 4G` and `proxy_request_buffering off` — video uploads
  stream through rather than buffering to nginx's disk.
- `proxy_read_timeout 3600s` on `/realtime/` — a progress socket sits idle
  between updates, and the default 60s would disconnect every client mid-render.
- Tighter `limit_req` on the auth paths than the rest of the API.
- `immutable` caching on `/_next/static/`, which is content-hashed.

Certificates:

```bash
certbot certonly --webroot -w /var/www/certbot -d yourdomain.com
```

---

## Kubernetes

The images are stateless apart from the media volume, so the manifests are
unremarkable. The pieces that matter:

**Split the deployments.** API and worker scale on different signals — requests
per second versus queue depth.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: lipsync-worker
spec:
  replicas: 4
  template:
    spec:
      # Workers hold a GPU; keep them on GPU nodes and off the API's.
      nodeSelector:
        cloud.google.com/gke-accelerator: nvidia-tesla-t4
      containers:
        - name: worker
          image: ghcr.io/yourorg/lipsync-api:latest
          command: ['node', 'dist/worker/index.js']
          resources:
            limits:
              nvidia.com/gpu: 1
          envFrom:
            - secretRef:
                name: lipsync-secrets
      # A render in flight must be allowed to finish; the worker's SIGTERM
      # handler waits for it rather than abandoning a job the user paid for.
      terminationGracePeriodSeconds: 900
```

**Probes.** `/health` is liveness — it does no I/O, so a slow database does not
cause a restart loop. `/ready` is readiness and checks every dependency, so a
pod with a broken database connection is drained instead of serving errors.

```yaml
livenessProbe:
  httpGet: { path: /health, port: 4000 }
  initialDelaySeconds: 15
readinessProbe:
  httpGet: { path: /ready, port: 4000 }
  periodSeconds: 10
```

**Autoscale workers on queue depth**, not CPU — a worker waiting on a GPU looks
idle to a CPU-based HPA.

---

## Operations

### Migrations

```bash
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
```

Run it before rolling the new image, and keep migrations additive across a
deploy so old and new pods can coexist during the rollout.

### Retention sweep

Assets past `expiresAt` are deleted by the maintenance queue. Schedule it:

```bash
docker compose exec api node -e "
  const { getMaintenanceQueue } = require('./dist/services/queue.js');
  getMaintenanceQueue()?.add('sweep', { task: 'retention_sweep' },
    { repeat: { pattern: '0 3 * * *' } });
"
```

The sweep skips assets referenced by an in-flight render, so it cannot fail a
job for a reason the user could not have predicted.

### Backups

```bash
docker compose exec postgres pg_dump -U lipsync lipsync | gzip > backup.sql.gz
```

Media is reproducible from source uploads but the uploads themselves are not —
enable bucket versioning or replicate to a second region.

### Monitoring

Watch these:

| Signal | Where | Why |
| --- | --- | --- |
| Queue `waiting` | `/v1/admin/overview` | Sustained > 0 means add workers |
| Job failure rate | `Job.status = failed` | A spike usually means a bad weights mount |
| `aiService.status` | `/ready` | Inference down degrades rendering, not the API |
| Storage growth | `/v1/admin/overview` | Retention sweep not running |
| Pending flags | `/v1/admin/overview` | Moderation review queue backing up |

Logs are newline-delimited JSON in production, with credentials, tokens and
password hashes redacted at the logger.

---

## Production checklist

- [ ] `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `AI_SERVICE_TOKEN` are real
      random values — the API refuses to boot in production with the dev
      defaults
- [ ] `NODE_ENV=production`
- [ ] TLS terminated, HSTS on
- [ ] `WEB_URL` and `API_URL` are the real origins (CORS and OAuth callbacks
      depend on them)
- [ ] Cloud storage configured with a CORS policy
- [ ] `ENABLE_VIRUS_SCAN=true` with ClamAV reachable
- [ ] Retention sweep scheduled
- [ ] Database backups running and restore tested
- [ ] Payment webhook secrets set and endpoints registered with the provider
- [ ] An admin account exists and 2FA is enabled on it
- [ ] Model weights mounted, `/health` reports `simulation: false`
- [ ] Engine licences reviewed against your use case
