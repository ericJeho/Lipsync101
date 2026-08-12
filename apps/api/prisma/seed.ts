import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

/**
 * Development seed. Creates one account per role plus a worked example project
 * with a finished render, so the dashboard and admin views have something real
 * to display on a fresh database.
 *
 * Idempotent — every write is an upsert keyed on a stable id or email, so this
 * can be re-run against an existing database without duplicating anything.
 */

const prisma = new PrismaClient();

const IDS = {
  adminUser: '00000000-0000-4000-8000-00000000a001',
  proUser: '00000000-0000-4000-8000-00000000a002',
  freeUser: '00000000-0000-4000-8000-00000000a003',
  project: '00000000-0000-4000-8000-00000000b001',
  videoAsset: '00000000-0000-4000-8000-00000000c001',
  audioAsset: '00000000-0000-4000-8000-00000000c002',
  job: '00000000-0000-4000-8000-00000000d001',
} as const;

const DEMO_PASSWORD = 'lipsync-demo-2026';

async function main(): Promise<void> {
  const passwordHash = await argon2.hash(DEMO_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 65_536,
    timeCost: 3,
    parallelism: 4,
  });

  const [admin, pro] = await Promise.all([
    prisma.user.upsert({
      where: { email: 'admin@lipsyncstudio.app' },
      create: {
        id: IDS.adminUser,
        email: 'admin@lipsyncstudio.app',
        name: 'Studio Admin',
        passwordHash,
        role: 'admin',
        plan: 'studio',
        credits: 500_000,
        emailVerified: true,
      },
      update: { role: 'admin', plan: 'studio' },
    }),
    prisma.user.upsert({
      where: { email: 'creator@lipsyncstudio.app' },
      create: {
        id: IDS.proUser,
        email: 'creator@lipsyncstudio.app',
        name: 'Ada Creator',
        passwordHash,
        plan: 'pro',
        credits: 20_000,
        emailVerified: true,
        countryCode: 'MW',
      },
      update: { plan: 'pro' },
    }),
    prisma.user.upsert({
      where: { email: 'free@lipsyncstudio.app' },
      create: {
        id: IDS.freeUser,
        email: 'free@lipsyncstudio.app',
        name: 'Sam Trial',
        passwordHash,
        plan: 'free',
        credits: 300,
        emailVerified: true,
      },
      update: {},
    }),
  ]);

  const project = await prisma.project.upsert({
    where: { id: IDS.project },
    create: {
      id: IDS.project,
      userId: pro.id,
      name: 'Chichewa launch spot',
      description: 'Product announcement re-voiced from English into Chichewa.',
      favorite: true,
    },
    update: {},
  });

  // A 42-second clip: long enough that the render estimate and credit maths
  // produce interesting numbers rather than rounding to nothing.
  const videoAsset = await prisma.asset.upsert({
    where: { id: IDS.videoAsset },
    create: {
      id: IDS.videoAsset,
      userId: pro.id,
      projectId: project.id,
      kind: 'video',
      status: 'ready',
      filename: 'presenter-take-03.mp4',
      mimeType: 'video/mp4',
      sizeBytes: BigInt(184_320_000),
      storageKey: 'video/seed/presenter-take-03.mp4',
      probe: {
        durationSeconds: 42.5,
        width: 1920,
        height: 1080,
        fps: 30,
        videoCodec: 'h264',
        audioCodec: 'aac',
        faceCount: 1,
        faceTrackStable: true,
      },
    },
    update: {},
  });

  const audioAsset = await prisma.asset.upsert({
    where: { id: IDS.audioAsset },
    create: {
      id: IDS.audioAsset,
      userId: pro.id,
      projectId: project.id,
      kind: 'audio',
      status: 'ready',
      filename: 'voiceover-chichewa.wav',
      mimeType: 'audio/wav',
      sizeBytes: BigInt(7_500_000),
      storageKey: 'audio/seed/voiceover-chichewa.wav',
      probe: { durationSeconds: 42.5, sampleRate: 48_000, channels: 1 },
      analysis: {
        language: { value: 'ny', confidence: 0.91 },
        emotion: { value: 'calm', confidence: 0.74 },
        gender: { value: 'female', confidence: 0.88 },
        tempo: null,
        speakingRate: { value: 138, confidence: 0.82 },
        isMusic: false,
        beats: [],
        durationSeconds: 42.5,
        waveform: Array.from({ length: 120 }, (_, i) =>
          Number((0.35 + 0.4 * Math.abs(Math.sin(i / 7))).toFixed(3)),
        ),
      },
    },
    update: {},
  });

  await prisma.job.upsert({
    where: { id: IDS.job },
    create: {
      id: IDS.job,
      userId: pro.id,
      projectId: project.id,
      videoAssetId: videoAsset.id,
      audioAssetId: audioAsset.id,
      status: 'completed',
      progress: 100,
      stage: 'Done',
      engine: 'musetalk',
      preset: 'balanced',
      outputFormat: 'mp4',
      outputHeight: 1080,
      enhancements: ['faceRestore', 'colorCorrect'],
      expression: {
        mouthIntensity: 74,
        smile: 52,
        eyeBlink: 50,
        expressionStrength: 60,
        headMovement: 50,
        emotionIntensity: 55,
      },
      translateTo: 'ny',
      subtitleLanguages: ['en', 'ny'],
      creditsCharged: 84,
      etaSeconds: 0,
      outputKey: 'render/seed/chichewa-launch.mp4',
      outputUrl: '/media/render/seed/chichewa-launch.mp4',
      startedAt: new Date(Date.now() - 3_600_000),
      completedAt: new Date(Date.now() - 3_540_000),
    },
    update: {},
  });

  await prisma.notification.createMany({
    data: [
      {
        userId: pro.id,
        type: 'render.completed',
        title: 'Your render is ready',
        body: 'Chichewa launch spot finished rendering.',
        link: `/dashboard/renders/${IDS.job}`,
      },
    ],
    skipDuplicates: true,
  });

  console.log(`Seeded.
  admin    admin@lipsyncstudio.app
  pro      creator@lipsyncstudio.app
  free     free@lipsyncstudio.app
  password ${DEMO_PASSWORD}

  ${admin.email} has the admin role; the demo project belongs to ${pro.email}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
