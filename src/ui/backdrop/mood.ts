import { useEffect, useRef, useState } from 'react';

/** Mood of the day on the interface scale: -3 (heavy) .. +3 (bright). See [data-mood] in themes.css. */
export type MoodStep = -3 | -2 | -1 | 0 | 1 | 2 | 3;

/** Maps a mood in -1..1 (null = unknown/neutral) to the nearest of seven steps with a tested aura. */
export function moodStep(mood: number | null | undefined): MoodStep {
  if (mood === null || mood === undefined || !Number.isFinite(mood)) return 0;
  const clamped = Math.max(-1, Math.min(1, mood));
  return (Math.round(clamped * 3) + 0) as MoodStep; // +0 turns -0 into 0
}

export interface AuraLayer {
  key: number;
  step: MoodStep;
  /** True for layers added after mount: they fade in (the first layer just appears). */
  fresh: boolean;
}

let layerKey = 0;

/**
 * Cross-fades between mood colours: a changed step adds a layer that fades in on top of the previous
 * one, which is removed once the fade is done. Only opacity animates; no filter is touched.
 */
export function useAuraLayers(step: MoodStep, fadeMs: number): AuraLayer[] {
  const [layers, setLayers] = useState<AuraLayer[]>(() => [{ key: ++layerKey, step, fresh: false }]);
  const lastStep = useRef(step);

  useEffect(() => {
    if (lastStep.current === step) return;
    lastStep.current = step;
    setLayers((prev) => [...prev.slice(-1), { key: ++layerKey, step, fresh: true }]);
    const timer = window.setTimeout(() => setLayers((prev) => prev.slice(-1)), fadeMs + 60);
    return () => window.clearTimeout(timer);
  }, [step, fadeMs]);

  return layers;
}
