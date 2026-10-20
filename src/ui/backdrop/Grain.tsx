import { useState } from 'react';
import { grainTileUrl } from './stars';
import { cx } from '../primitives/cx';
import styles from './Backdrop.module.css';

/**
 * The 128 px noise tile as a static layer, generated once by a canvas. No `mix-blend-mode` (expensive on
 * phones); the opacity is `--grain-opacity` times the tier multiplier `--fx-grain` (0 on mid/low tiers).
 */
export function Grain({ className }: { className?: string }) {
  const [url] = useState(grainTileUrl);
  if (!url) return null;
  return <div className={cx(styles.grain, className)} style={{ backgroundImage: url }} aria-hidden="true" data-testid="grain" />;
}
