'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Activity, Layers, Music4, Sliders, Sparkles, Wand2 } from 'lucide-react';
import { Nav } from '@/components/layout/Nav';
import { MediaInput } from '@/components/studio/MediaInput';
import { EnginePanel } from '@/components/studio/EnginePanel';
import {
  AnalysisPanel,
  AudioPanel,
  EnhancementPanel,
  ExpressionPanel,
} from '@/components/studio/ControlPanels';
import { Timeline } from '@/components/studio/Timeline';
import { ComparePlayer } from '@/components/studio/ComparePlayer';
import { RenderPanel } from '@/components/studio/RenderPanel';
import { Card, Tabs } from '@/components/ui/primitives';
import { useStudio } from '@/store/studio';

type PanelTab = 'engine' | 'expression' | 'enhance' | 'audio' | 'analysis';

const TABS = [
  { id: 'engine' as const, label: 'Engine', icon: <Sparkles className="size-3.5" /> },
  { id: 'expression' as const, label: 'Expression', icon: <Sliders className="size-3.5" /> },
  { id: 'enhance' as const, label: 'Enhance', icon: <Wand2 className="size-3.5" /> },
  { id: 'audio' as const, label: 'Audio', icon: <Music4 className="size-3.5" /> },
  { id: 'analysis' as const, label: 'Analysis', icon: <Activity className="size-3.5" /> },
];

export default function StudioPage() {
  const [tab, setTab] = useState<PanelTab>('engine');

  const video = useStudio((state) => state.video);
  const analysis = useStudio((state) => state.analysis);
  const render = useStudio((state) => state.render);
  const projectName = useStudio((state) => state.projectName);
  const setProject = useStudio((state) => state.setProject);

  return (
    <>
      <Nav />

      <main id="main" className="mx-auto max-w-[100rem] px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <input
              value={projectName}
              onChange={(event) => setProject(null, event.target.value)}
              aria-label="Project name"
              className="-ml-2 rounded-lg bg-transparent px-2 py-1 text-2xl font-semibold tracking-tight outline-none transition-colors hover:bg-surface-raised focus:bg-surface-raised"
            />
            <p className="mt-1 text-sm text-ink-muted">
              Upload a face and a track, shape the performance, then render.
            </p>
          </div>

          <span className="flex items-center gap-2 rounded-xl border border-line bg-surface-raised/50 px-3 py-2 text-xs text-ink-muted">
            <Layers className="size-3.5 text-brand" />
            Changes save as you work
          </span>
        </header>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
          {/* ---------------- Left: media, preview, timeline ---------------- */}
          <div className="min-w-0 space-y-6">
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <p className="mb-3 text-sm font-medium">1 · Face video</p>
                <MediaInput kind="video" />
              </Card>
              <Card>
                <p className="mb-3 text-sm font-medium">2 · Driving audio</p>
                <MediaInput kind="audio" />
              </Card>
            </div>

            <motion.div layout>
              <Card>
                <p className="mb-4 text-sm font-medium">Preview</p>
                <ComparePlayer
                  originalUrl={video?.localUrl}
                  resultUrl={render.outputUrl ?? undefined}
                  fps={video?.fps ?? 30}
                />
              </Card>
            </motion.div>

            <motion.div layout>
              <Card className="p-0">
                <p className="border-b border-line px-5 py-4 text-sm font-medium">Timeline</p>
                <div className="p-4">
                  <Timeline />
                </div>
              </Card>
            </motion.div>
          </div>

          {/* ---------------- Right: controls and render ---------------- */}
          <div className="space-y-6">
            <Card className="p-0">
              <div className="border-b border-line p-3">
                <Tabs tabs={TABS} active={tab} onChange={setTab} wrap />
              </div>
              <div className="max-h-[32rem] overflow-y-auto p-5">
                {tab === 'engine' && <EnginePanel />}
                {tab === 'expression' && <ExpressionPanel />}
                {tab === 'enhance' && <EnhancementPanel />}
                {tab === 'audio' && <AudioPanel />}
                {tab === 'analysis' && <AnalysisPanel analysis={analysis} />}
              </div>
            </Card>

            <Card glow>
              <p className="mb-4 text-sm font-medium">3 · Render</p>
              <RenderPanel />
            </Card>
          </div>
        </div>
      </main>
    </>
  );
}
