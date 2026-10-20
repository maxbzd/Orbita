import { useEffect, useRef } from 'react';
import { useDocumentVisible, useOnScreen, useOverlayOpen } from '../../styles/media';
import { TIER_BUDGETS, useReducedMotion, useTheme, useEffectsTier } from '../../styles/theme';
import { cx } from '../primitives/cx';
import { generateStars, starTileUrl, twinkleAlpha } from './stars';
import styles from './Backdrop.module.css';

export interface SkyProps {
  /** Lets the canvas layer twinkle a few stars on the high tier. Default true. */
  twinkle?: boolean;
  className?: string;
}

/**
 * The night sky: a vertical gradient plus one static SVG tile of stars (rasterised once). The stars are
 * hidden in "Рассвет". On the high tier a light canvas adds ~28 twinkling stars; it stops when the tab is
 * hidden, the layer is off screen, motion is reduced or a real-blur layer is open above it.
 */
export function Sky({ twinkle = true, className }: SkyProps) {
  const { resolvedTheme } = useTheme();
  const { tier } = useEffectsTier();
  const reduced = useReducedMotion();
  const night = resolvedTheme === 'night';
  const count = TIER_BUDGETS[tier].twinkleStars;

  return (
    <div className={cx(styles.sky, className)} aria-hidden="true" data-testid="sky">
      <div className={styles.stars} style={{ backgroundImage: starTileUrl() }} />
      {twinkle && night && count > 0 && !reduced ? <Twinkle count={count} /> : null}
    </div>
  );
}

const FRAME_MS = 50; // 20 fps is plenty for a slow shimmer

function Twinkle({ count }: { count: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onScreen = useOnScreen(canvasRef);
  const visible = useDocumentVisible();
  const overlay = useOverlayOpen();
  const active = onScreen && visible && !overlay;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    // Different seed from the static tile, so the shimmering stars are not on top of the fixed ones.
    const stars = generateStars(count, 909);
    let width = 0;
    let height = 0;
    const resize = (): void => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const draw = (t: number): void => {
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#fff';
      for (const star of stars) {
        ctx.globalAlpha = twinkleAlpha(star, t);
        ctx.beginPath();
        ctx.arc(star.x * width, star.y * height * 0.8, star.r + 0.35, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    if (!active) {
      draw(0); // a still frame while paused, so the stars do not vanish
      return () => window.removeEventListener('resize', resize);
    }

    let raf = 0;
    let last = -Infinity;
    const frame = (now: number): void => {
      if (now - last >= FRAME_MS) {
        last = now;
        draw(now);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [active, count]);

  return <canvas ref={canvasRef} className={styles.twinkle} />;
}
