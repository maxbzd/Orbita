import type { CSSProperties } from 'react';
import { useDocumentVisible } from '../../styles/media';
import { useReducedMotion } from '../../styles/theme';
import { cx } from '../primitives/cx';
import { moodStep, useAuraLayers } from './mood';
import styles from './Backdrop.module.css';

export type AuraExtent = 'hero' | 'full' | 'edge';

export interface AuraProps {
  /** Mood of the day in -1..1; `null` or undefined = neutral. */
  mood?: number | null;
  /**
   * Loudness 0..1. Onboarding and the splash 1; the top of "Сегодня" about .7; empty states .25;
   * working lists 0.
   */
  intensity?: number;
  /** hero: top 70 % fading into the flat background; full: the whole screen; edge: a glow at the top edge. */
  extent?: AuraExtent;
  className?: string;
}

/**
 * Three radial gradients, the colours coming from the `[data-mood]` tokens (every pair is contrast-tested
 * against ink and ink-2). The soft edge is baked into the gradients: no blur filter. A changed mood
 * cross-fades over 900 ms; the slow drift is a CSS variable the quality tier can switch off.
 */
export function Aura({ mood = 0, intensity = 1, extent = 'hero', className }: AuraProps) {
  const reduced = useReducedMotion();
  const visible = useDocumentVisible();
  const layers = useAuraLayers(moodStep(mood), reduced ? 120 : 900);
  const level = Math.max(0, Math.min(1, Number.isFinite(intensity) ? intensity : 1));

  return (
    <div
      className={cx(styles.aura, styles[extent], className)}
      style={{ '--aura-level': level } as CSSProperties}
      data-paused={visible ? undefined : ''}
      data-testid="aura"
      aria-hidden="true"
    >
      {layers.map((layer) => (
        <div key={layer.key} className={cx(styles.auraLayer, layer.fresh && styles.fresh)} data-mood={layer.step}>
          <div className={styles.glow} />
        </div>
      ))}
    </div>
  );
}
