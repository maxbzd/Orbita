import { cx } from '../primitives/cx';
import { Aura } from './Aura';
import type { AuraExtent } from './Aura';
import { Grain } from './Grain';
import { Sky } from './Sky';
import styles from './Backdrop.module.css';

export interface BackdropProps {
  /** Mood of the day in -1..1 for the aura colour. */
  mood?: number | null;
  /** Aura loudness 0..1 (0 = no aura: working lists). Default .5. */
  auraIntensity?: number;
  auraExtent?: AuraExtent;
  /** Film grain on top (high tier only, via --fx-grain). Default true. */
  grain?: boolean;
  /** Twinkling stars (high tier, night). Default true. */
  twinkle?: boolean;
  className?: string;
}

/**
 * Sky + Aura + grain: one fixed layer behind every screen (z-index 0, under the content at 2). It has no
 * pointer events and no semantics. Nothing here uses `filter` or `backdrop-filter`.
 */
export function Backdrop({ mood = 0, auraIntensity = 0.5, auraExtent = 'hero', grain = true, twinkle = true, className }: BackdropProps) {
  return (
    <div className={cx(styles.backdrop, className)} aria-hidden="true" data-testid="backdrop">
      <Sky twinkle={twinkle} />
      {auraIntensity > 0 ? <Aura mood={mood} intensity={auraIntensity} extent={auraExtent} /> : null}
      {grain ? <Grain /> : null}
    </div>
  );
}
