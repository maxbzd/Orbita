import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useEffectsTier, useReducedMotion, useTheme } from '../../styles/theme';
import { cx } from '../primitives/cx';
import { CssOrb } from './CssOrb';
import styles from './Orb.module.css';
import { backingScale, pointsForSize } from './geometry';
import type { OrbState } from './model';
import { OrbScene, canvas2dAvailable } from './scene';
import { readLevel } from './useOrbLevel';
import type { LevelInput } from './useOrbLevel';
import { useOrbActive } from './useOrbActive';

export interface OrbProps {
  state?: OrbState;
  /** Voice level 0..1 while `listening`: a number, or the ref from `useOrbLevel` (no re-render per frame). */
  level?: LevelInput;
  /** Diameter in CSS px: 220 hero, 68 navigation, 40 header, 24 inside rows. */
  size?: number;
  /** "Режим прогулки": 15 frames per second at 30 % brightness. */
  walk?: boolean;
  /** Frame-rate cap; the tier's budget (60 / 30) is the upper limit. */
  fps?: number;
  /** Overrides the number of dots (a lighter orb for a button). The tier's budget is still the upper limit. */
  points?: number;
  /** Radar rings around the hero orb while listening. Default: on from 120 px up. */
  radar?: boolean;
  /** Accessible name. Without it the orb is decorative: the status pill next to it says what it does. */
  label?: string;
  /** Stop animating while a sheet or dialog (real blur) is open. Default true. */
  pauseUnderOverlay?: boolean;
  className?: string;
  style?: CSSProperties;
}

export const WALK_FPS = 15;
export const WALK_BRIGHTNESS = 0.3;

/**
 * The orb: a sphere of dots on Canvas 2D (about 1 200 on the
 * high tier, 600 on the middle one) that listens, pauses, folds into a torus while thinking and flashes when
 * done. On the low tier, under reduced motion, or without a 2D canvas it is the CSS sphere (`CssOrb`).
 *
 * The animation stops when the tab is hidden, the orb is scrolled away, or a blurred layer opens above it.
 */
export function Orb(props: OrbProps) {
  const { size = 220, points } = props;
  const reduced = useReducedMotion();
  const { budget } = useEffectsTier();
  const [supported] = useState(canvas2dAvailable);

  const fromBudget = pointsForSize(size, budget.orbPoints);
  const count = points === undefined ? fromBudget : Math.min(points, budget.orbPoints);

  if (reduced || !supported || budget.orbPoints === 0 || count <= 0) {
    return (
      <CssOrb
        state={props.state}
        level={props.level}
        size={size}
        label={props.label}
        pauseUnderOverlay={props.pauseUnderOverlay}
        className={props.className}
        style={props.style}
      />
    );
  }
  return <CanvasOrb {...props} size={size} count={count} frameCap={budget.orbFps} />;
}

interface CanvasOrbProps extends OrbProps {
  size: number;
  count: number;
  frameCap: number;
}

function CanvasOrb({
  state = 'idle',
  level = 0,
  size,
  count,
  frameCap,
  walk = false,
  fps,
  radar,
  label,
  pauseUnderOverlay = true,
  className,
  style,
}: CanvasOrbProps) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<OrbScene | null>(null);
  const levelRef = useRef<LevelInput>(level);
  const { resolvedTheme } = useTheme();
  const active = useOrbActive(rootRef, pauseUnderOverlay);
  const dpr = backingScale(typeof window === 'undefined' ? 1 : window.devicePixelRatio);

  useEffect(() => {
    levelRef.current = level;
  });

  const rate = Math.max(1, Math.min(walk ? WALK_FPS : (fps ?? frameCap), frameCap));
  const brightness = walk ? WALK_BRIGHTNESS : 1;

  // The scene: geometry, model and sprites. Rebuilt only when the picture itself changes size or palette.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return undefined;
    const side = Math.round(size * dpr);
    canvas.width = side; // backing store: at most 2x the CSS size
    canvas.height = side;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const scene = new OrbScene({ size, points: count, theme: resolvedTheme, dpr, initialState: state });
    sceneRef.current = scene;
    scene.draw(ctx, brightness); // a first frame at once, so the orb is never blank
    return () => {
      sceneRef.current = null;
    };
    // `state` and `brightness` only seed the first frame; the loop below follows them.
  }, [size, count, resolvedTheme, dpr]);

  // The frame loop. It exists only while the orb is worth animating.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const scene = sceneRef.current;
    if (!canvas || !ctx || !scene) return undefined;

    if (!active) {
      scene.step(0, state, 0);
      scene.draw(ctx, brightness); // one still frame in the current state
      return undefined;
    }

    const interval = 1000 / rate;
    let raf = 0;
    let last = -1;
    const frame = (now: number): void => {
      raf = requestAnimationFrame(frame);
      if (last < 0) last = now - interval;
      const elapsed = now - last;
      if (elapsed < interval * 0.9) return;
      last = now;
      scene.step(Math.min(elapsed, 100), state, readLevel(levelRef.current, now));
      scene.draw(ctx, brightness);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [active, rate, state, brightness, size, count, resolvedTheme, dpr]);

  const showRadar = (radar ?? size >= 120) && state === 'listening';
  const labelled = label ? ({ role: 'img', 'aria-label': label } as const) : ({ 'aria-hidden': true } as const);

  return (
    <span
      ref={rootRef}
      className={cx(styles.orb, className)}
      style={{ '--orb-size': `${size}px`, ...style } as CSSProperties}
      data-engine="canvas"
      data-state={state}
      {...labelled}
    >
      {showRadar
        ? [0, 0.4, 0.8].map((delay) => (
            <span key={delay} className={styles.radar} style={{ '--delay': `${delay}s` } as CSSProperties} data-testid="orb-radar" />
          ))
        : null}
      <canvas ref={canvasRef} className={styles.canvas} width={Math.round(size * dpr)} height={Math.round(size * dpr)} />
    </span>
  );
}
