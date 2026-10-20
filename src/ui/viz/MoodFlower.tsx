import { useMemo } from 'react';
import type { SVGAttributes } from 'react';
import { useReducedMotion } from '../../styles/theme';
import { cx } from '../primitives/cx';
import { flowerPath, levelToValue } from './flower';
import { useSvgId, useTweenedValue } from './hooks';
import { clampMood, moodHex, moodSpoken } from './mood';
import { polar } from './polar';
import styles from './MoodFlower.module.css';
import { t } from '../../i18n';

/** Sizes the flower is used at (docs §2.2): calendar garden, inside a record, check-in. */
export const FLOWER_SIZES = { garden: 14, record: 28, checkin: 120 } as const;

export interface MoodFlowerProps extends Omit<SVGAttributes<SVGSVGElement>, 'viewBox' | 'width' | 'height' | 'children' | 'values'> {
  /** Mood −3…+3; fractions are fine (the slider passes the finger position). */
  value?: number;
  /** The same thing normalised: −1…+1 continuous, 0 is the circle. Used when `value` is not given. */
  level?: number;
  /** Box in px. 14 / 28 / 120 are the designed sizes; any number works. Default 120. */
  size?: number;
  /** Accessible name; defaults to the mood word. Ignored when `decorative`. */
  label?: string;
  /** The flower sits beside its word or number, so it adds nothing to read aloud. */
  decorative?: boolean;
  /** The glass layer (a second, offset contour). Default: only from 64 px up. */
  glass?: boolean;
  /** Glide to a new value in `duration` ms. Off under reduced motion. Default false. */
  animate?: boolean;
  duration?: number;
}

/**
 * The mood flower: star → circle → flower, a polar contour built by `flowerShape`
 *, filled with the mood colour interpolated in OKLCH.
 */
export function MoodFlower({
  value,
  level,
  size = FLOWER_SIZES.checkin,
  label,
  decorative = false,
  glass,
  animate = false,
  duration = 360,
  className,
  style,
  ...rest
}: MoodFlowerProps) {
  const reduced = useReducedMotion();
  const target = clampMood(value ?? (level === undefined ? 0 : levelToValue(level)));
  const shown = useTweenedValue(target, { duration, disabled: !animate || reduced });
  const id = useSvgId('flower');
  const withGlass = glass ?? size >= 64;

  const path = useMemo(() => flowerPath(shown, { size: 120 }), [shown]);
  const glassPath = useMemo(() => (withGlass ? flowerPath(shown, { size: 104, cx: 55, cy: 54 }) : ''), [shown, withGlass]);
  const fill = moodHex(shown);
  const name = label ?? t('State: {moodSpoken}', { moodSpoken: moodSpoken(shown) });
  const shine = polar(60, 60, 30, -0.8);

  return (
    <svg
      {...rest}
      className={cx(styles.flower, className)}
      style={style}
      width={size}
      height={size}
      viewBox="0 0 120 120"
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative ? true : undefined}
      focusable="false"
      data-mood={Math.round(shown * 100) / 100}
    >
      {size >= 28 ? (
        <defs>
          <radialGradient id={`${id}-shine`} cx={shine.x} cy={shine.y} r="70" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#fff" stopOpacity="0.5" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
        </defs>
      ) : null}
      <path d={path} fill={fill} />
      {size >= 28 ? <path d={path} fill={`url(#${id}-shine)`} /> : null}
      {withGlass ? <path d={glassPath} className={styles.glass} /> : null}
    </svg>
  );
}
