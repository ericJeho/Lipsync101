'use client';

import { useState } from 'react';
import { Check, Copy, Terminal } from 'lucide-react';
import { Nav } from '@/components/layout/Nav';
import { Footer } from '@/components/layout/Footer';
import { Card, SectionHeading, Tabs } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';

type Language = 'curl' | 'javascript' | 'python' | 'php' | 'flutter';

const SNIPPETS: Record<Language, string> = {
  curl: `# 1. Reserve an upload and PUT the bytes to the returned URL
curl -X POST https://api.lipsyncstudio.app/v1/assets/uploads \\
  -H "X-API-Key: $LIPSYNC_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "filename": "presenter.mp4",
    "contentType": "video/mp4",
    "sizeBytes": 18432000,
    "kind": "video"
  }'

# 2. Submit the render
curl -X POST https://api.lipsyncstudio.app/v1/jobs \\
  -H "X-API-Key: $LIPSYNC_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "projectId": "PROJECT_UUID",
    "videoAssetId": "VIDEO_UUID",
    "audioAssetId": "AUDIO_UUID",
    "preset": "balanced",
    "outputHeight": 1080,
    "enhancements": ["faceRestore"],
    "translateTo": "ny"
  }'

# 3. Poll, or subscribe to the job.completed webhook instead
curl https://api.lipsyncstudio.app/v1/jobs/JOB_UUID \\
  -H "X-API-Key: $LIPSYNC_API_KEY"`,

  javascript: `import { createReadStream, statSync } from 'node:fs';

const API = 'https://api.lipsyncstudio.app/v1';
const headers = {
  'X-API-Key': process.env.LIPSYNC_API_KEY,
  'Content-Type': 'application/json',
};

async function upload(path, kind, contentType) {
  const { size } = statSync(path);

  const { asset, upload } = await fetch(\`\${API}/assets/uploads\`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      filename: path.split('/').pop(),
      contentType,
      sizeBytes: size,
      kind,
    }),
  }).then((r) => r.json());

  // The bytes go straight to storage — they never transit our API.
  await fetch(upload.url, {
    method: upload.method,
    headers: upload.headers,
    body: createReadStream(path),
    duplex: 'half',
  });

  await fetch(\`\${API}/assets/\${asset.id}/complete\`, { method: 'POST', headers });
  return asset.id;
}

const [videoAssetId, audioAssetId] = await Promise.all([
  upload('./presenter.mp4', 'video', 'video/mp4'),
  upload('./voiceover.wav', 'audio', 'audio/wav'),
]);

const { job } = await fetch(\`\${API}/jobs\`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    projectId: process.env.PROJECT_ID,
    videoAssetId,
    audioAssetId,
    preset: 'balanced',
    outputHeight: 1080,
  }),
}).then((r) => r.json());

console.log('queued', job.id);`,

  python: `import os
import time
import requests

API = "https://api.lipsyncstudio.app/v1"
session = requests.Session()
session.headers["X-API-Key"] = os.environ["LIPSYNC_API_KEY"]


def upload(path: str, kind: str, content_type: str) -> str:
    size = os.path.getsize(path)

    reserved = session.post(
        f"{API}/assets/uploads",
        json={
            "filename": os.path.basename(path),
            "contentType": content_type,
            "sizeBytes": size,
            "kind": kind,
        },
    ).json()

    with open(path, "rb") as handle:
        requests.put(
            reserved["upload"]["url"],
            data=handle,
            headers=reserved["upload"]["headers"],
        ).raise_for_status()

    asset_id = reserved["asset"]["id"]
    session.post(f"{API}/assets/{asset_id}/complete").raise_for_status()
    return asset_id


video_id = upload("presenter.mp4", "video", "video/mp4")
audio_id = upload("voiceover.wav", "audio", "audio/wav")

job = session.post(
    f"{API}/jobs",
    json={
        "projectId": os.environ["PROJECT_ID"],
        "videoAssetId": video_id,
        "audioAssetId": audio_id,
        "preset": "balanced",
        "outputHeight": 1080,
        "subtitles": {"enabled": True, "languages": ["en", "sw"]},
    },
).json()["job"]

# Prefer the job.completed webhook in production; polling is fine for scripts.
while job["status"] not in ("completed", "failed", "cancelled"):
    time.sleep(5)
    job = session.get(f"{API}/jobs/{job['id']}").json()["job"]
    print(f"{job['progress']:>3}%  {job['stage']}")

print(job.get("outputUrl"))`,

  php: `<?php

$api = 'https://api.lipsyncstudio.app/v1';
$key = getenv('LIPSYNC_API_KEY');

function call(string $method, string $path, ?array $body = null): array
{
    global $api, $key;

    $handle = curl_init("$api$path");
    curl_setopt_array($handle, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => [
            "X-API-Key: $key",
            'Content-Type: application/json',
        ],
        CURLOPT_POSTFIELDS => $body ? json_encode($body) : null,
    ]);

    $response = curl_exec($handle);
    $status = curl_getinfo($handle, CURLINFO_HTTP_CODE);
    curl_close($handle);

    if ($status >= 400) {
        throw new RuntimeException("LipSync API returned $status: $response");
    }

    return json_decode($response, true);
}

$result = call('POST', '/jobs', [
    'projectId' => getenv('PROJECT_ID'),
    'videoAssetId' => $videoAssetId,
    'audioAssetId' => $audioAssetId,
    'preset' => 'balanced',
    'outputHeight' => 1080,
]);

echo "Queued {$result['job']['id']}\\n";`,

  flutter: `import 'dart:convert';
import 'package:http/http.dart' as http;

class LipSyncClient {
  LipSyncClient(this.apiKey, {this.baseUrl = 'https://api.lipsyncstudio.app/v1'});

  final String apiKey;
  final String baseUrl;

  Map<String, String> get _headers => {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json',
      };

  Future<Map<String, dynamic>> createJob({
    required String projectId,
    required String videoAssetId,
    required String audioAssetId,
    String preset = 'balanced',
    int outputHeight = 1080,
  }) async {
    final response = await http.post(
      Uri.parse('\$baseUrl/jobs'),
      headers: _headers,
      body: jsonEncode({
        'projectId': projectId,
        'videoAssetId': videoAssetId,
        'audioAssetId': audioAssetId,
        'preset': preset,
        'outputHeight': outputHeight,
      }),
    );

    if (response.statusCode >= 400) {
      final error = jsonDecode(response.body)['error'];
      throw Exception(error['message'] ?? 'Render could not be queued');
    }

    return jsonDecode(response.body)['job'] as Map<String, dynamic>;
  }

  /// Progress also arrives over the realtime channel; polling suits background
  /// isolates that are not holding a socket open.
  Stream<Map<String, dynamic>> watch(String jobId) async* {
    while (true) {
      final response = await http.get(
        Uri.parse('\$baseUrl/jobs/\$jobId'),
        headers: _headers,
      );
      final job = jsonDecode(response.body)['job'] as Map<String, dynamic>;
      yield job;

      if (['completed', 'failed', 'cancelled'].contains(job['status'])) return;
      await Future<void>.delayed(const Duration(seconds: 5));
    }
  }
}`,
};

const ENDPOINTS = [
  { method: 'POST', path: '/v1/assets/uploads', description: 'Reserve an upload and get a presigned URL.' },
  { method: 'POST', path: '/v1/assets/:id/complete', description: 'Finalise an upload; probes, scans and moderates it.' },
  { method: 'POST', path: '/v1/assets/:id/analyze', description: 'Voice analysis with confidence scores.' },
  { method: 'POST', path: '/v1/assets/:id/extract-audio', description: 'Pull the audio track out of a video.' },
  { method: 'POST', path: '/v1/jobs', description: 'Submit a render.' },
  { method: 'POST', path: '/v1/jobs/quote', description: 'Price a render without submitting it.' },
  { method: 'POST', path: '/v1/jobs/batch', description: 'Submit up to fifty renders at once.' },
  { method: 'GET', path: '/v1/jobs/:id', description: 'Status, progress, queue position and output.' },
  { method: 'POST', path: '/v1/jobs/:id/cancel', description: 'Cancel; refunds if it never reached a GPU.' },
  { method: 'POST', path: '/v1/subtitles/jobs/:id/generate', description: 'Transcribe, translate and align.' },
  { method: 'GET', path: '/v1/subtitles/jobs/:id/export', description: 'Export SRT, WebVTT or karaoke VTT.' },
  { method: 'POST', path: '/v1/graphql', description: 'Read-oriented GraphQL surface over the same data.' },
];

const METHOD_TONE: Record<string, string> = {
  GET: 'text-success',
  POST: 'text-brand',
  DELETE: 'text-danger',
};

export default function DevelopersPage() {
  const [language, setLanguage] = useState<Language>('curl');
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(SNIPPETS[language]);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <>
      <Nav />

      <main id="main" className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow="Developers"
          title="A REST API, a GraphQL surface and signed webhooks"
          description="Authenticate with an API key, upload straight to storage, submit renders and receive a signed callback when they finish. Studio plan and above."
        />

        <div className="mt-14 grid gap-8 lg:grid-cols-[1fr_20rem]">
          <div className="min-w-0 space-y-6">
            <Card className="p-0">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-3">
                <Tabs
                  tabs={[
                    { id: 'curl' as const, label: 'cURL' },
                    { id: 'javascript' as const, label: 'JavaScript' },
                    { id: 'python' as const, label: 'Python' },
                    { id: 'php' as const, label: 'PHP' },
                    { id: 'flutter' as const, label: 'Flutter' },
                  ]}
                  active={language}
                  onChange={setLanguage}
                />

                <button
                  type="button"
                  onClick={copy}
                  className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:text-ink"
                >
                  {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>

              <pre className="hide-scrollbar overflow-x-auto p-5 text-xs leading-relaxed">
                <code className="font-mono">{SNIPPETS[language]}</code>
              </pre>
            </Card>

            <Card>
              <p className="mb-4 flex items-center gap-2 text-sm font-medium">
                <Terminal className="size-4 text-brand" />
                Endpoints
              </p>
              <ul className="divide-y divide-line">
                {ENDPOINTS.map((endpoint) => (
                  <li key={endpoint.path} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5">
                    <span
                      className={cn(
                        'w-14 shrink-0 font-mono text-[11px] font-semibold',
                        METHOD_TONE[endpoint.method],
                      )}
                    >
                      {endpoint.method}
                    </span>
                    <code className="font-mono text-xs">{endpoint.path}</code>
                    <span className="w-full text-xs text-ink-subtle sm:w-auto sm:flex-1">
                      {endpoint.description}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          <aside className="space-y-4">
            <Card>
              <p className="mb-2 text-sm font-medium">Authentication</p>
              <p className="text-xs leading-relaxed text-ink-muted">
                Send your key as <code className="font-mono">X-API-Key</code>. Keys are shown once
                at creation and stored only as a hash, so a database leak cannot be replayed
                against the API.
              </p>
            </Card>

            <Card>
              <p className="mb-2 text-sm font-medium">Webhook signatures</p>
              <p className="text-xs leading-relaxed text-ink-muted">
                Every delivery carries{' '}
                <code className="font-mono">X-LipSync-Signature: t=&lt;ts&gt;,v1=&lt;sig&gt;</code>,
                an HMAC-SHA256 of <code className="font-mono">&lt;ts&gt;.&lt;raw body&gt;</code>.
                Compare it in constant time and reject timestamps older than five minutes.
              </p>
            </Card>

            <Card>
              <p className="mb-2 text-sm font-medium">Rate limits</p>
              <p className="text-xs leading-relaxed text-ink-muted">
                120 requests a minute overall and 20 render submissions a minute, keyed on your
                account. Responses carry <code className="font-mono">RateLimit</code> headers.
              </p>
            </Card>

            <Card>
              <p className="mb-2 text-sm font-medium">Errors</p>
              <p className="text-xs leading-relaxed text-ink-muted">
                Always{' '}
                <code className="font-mono">
                  {'{ error: { code, message, details? } }'}
                </code>
                . A <code className="font-mono">402 plan_limit</code> carries the limit and the
                actual value in <code className="font-mono">details</code>.
              </p>
            </Card>
          </aside>
        </div>
      </main>

      <Footer />
    </>
  );
}
