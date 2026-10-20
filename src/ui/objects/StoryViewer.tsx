import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react';
import { useReducedMotion } from '../../styles/theme';
import { useDocumentVisible } from '../../styles/media';
import { Icon } from '../icons';
import { cx } from '../primitives/cx';
import { classifyGesture, useStoryClock } from './storyLogic';
import styles from './StoryViewer.module.css';
import { t } from '../../i18n';

export interface StorySlide {
  id: string;
  /** Usually an object (`Poster`, `Passport`, `InsightStar` …) or a glass stat card over the cover. */
  content: ReactNode;
  /** Said by screen readers when the slide appears. */
  label?: string;
  /** Overrides the viewer's duration for this slide. */
  durationMs?: number;
}

export interface StoryExportInfo {
  index: number;
  slide: StorySlide;
  /** The element that holds the slide: pass it to `saveAsImage` / `exportToBlob` (it finds the `<svg>` inside). */
  element: HTMLElement;
}

export interface StoryViewerProps {
  slides: readonly StorySlide[];
  /** Controlled slide index. */
  index?: number;
  defaultIndex?: number;
  onIndexChange?: (index: number) => void;
  /** Run the slides on a timer. Default true; always off under reduced motion (docs §2.7). */
  autoAdvance?: boolean;
  /** Default slide length in ms. Default 5000. */
  durationMs?: number;
  onClose?: () => void;
  /** The last slide ran out or was paged past. */
  onFinish?: () => void;
  /** "Сохранить картинку". The button is shown only when this is given. */
  onExport?: (info: StoryExportInfo) => void;
  exportLabel?: string;
  /** Name of the whole story for screen readers ("Чтение недели"). */
  label?: string;
  className?: string;
}

const DEFAULT_DURATION = 5000;

/**
 * A 9:16 story player for the reviews (docs §2.7, §3.6): segments on top, an auto-advance of 5 s that pauses while the
 * finger is held, taps (left third back, otherwise forward), swipes, arrow keys, Space to pause, Esc to close. Under
 * reduced motion it never advances by itself. Presentational: slides and callbacks come from the parent.
 */
export function StoryViewer({
  slides,
  index: controlledIndex,
  defaultIndex = 0,
  onIndexChange,
  autoAdvance = true,
  durationMs = DEFAULT_DURATION,
  onClose,
  onFinish,
  onExport,
  exportLabel = t('Save the image'),
  label = t('Stories'),
  className,
}: StoryViewerProps) {
  const count = slides.length;
  const reduced = useReducedMotion();
  const visible = useDocumentVisible();
  const [innerIndex, setInnerIndex] = useState(() => Math.min(Math.max(0, defaultIndex), Math.max(0, count - 1)));
  const index = Math.min(Math.max(0, controlledIndex ?? innerIndex), Math.max(0, count - 1));
  const [restarts, setRestarts] = useState(0);
  const [paused, setPaused] = useState(false);
  const [held, setHeld] = useState(false);
  const slideRef = useRef<HTMLDivElement>(null);
  const barRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const press = useRef<{ x: number; y: number; at: number } | null>(null);

  const slide = slides[index];
  const duration = slide?.durationMs ?? durationMs;
  const auto = autoAdvance && !reduced && count > 0;

  const go = useCallback(
    (next: number) => {
      if (next === index) return;
      if (controlledIndex === undefined) setInnerIndex(next);
      onIndexChange?.(next);
    },
    [controlledIndex, index, onIndexChange],
  );
  const next = useCallback(() => {
    if (index < count - 1) go(index + 1);
    else onFinish?.();
  }, [count, go, index, onFinish]);
  const prev = useCallback(() => {
    if (index > 0) go(index - 1);
    else setRestarts((n) => n + 1);
  }, [go, index]);

  useStoryClock({
    running: auto && !paused && !held && visible,
    duration,
    slideKey: `${index}:${restarts}`,
    onProgress: (progress) => {
      const bar = barRefs.current[index];
      if (bar) bar.style.transform = `scaleX(${progress})`;
    },
    onDone: next,
  });

  // Bars of other slides are static: full before the current one, empty after it.
  useEffect(() => {
    barRefs.current.forEach((bar, i) => {
      if (!bar || i === index) return;
      bar.style.transform = i < index ? 'scaleX(1)' : 'scaleX(0)';
    });
  }, [index, count]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    press.current = { x: event.clientX, y: event.clientY, at: Date.now() };
    setHeld(true);
  };
  const finishPress = (event: PointerEvent<HTMLDivElement>, cancelled: boolean): void => {
    const start = press.current;
    press.current = null;
    setHeld(false);
    if (!start || cancelled) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const gesture = classifyGesture({
      dx: event.clientX - start.x,
      dy: event.clientY - start.y,
      duration: Date.now() - start.at,
      x: rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0.5,
    });
    if (gesture === 'next') next();
    else if (gesture === 'prev') prev();
    else if (gesture === 'close') onClose?.();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const onRoot = event.target === event.currentTarget;
    switch (event.key) {
      case 'ArrowRight':
        next();
        break;
      case 'ArrowLeft':
        prev();
        break;
      case 'Home':
        go(0);
        break;
      case 'End':
        go(count - 1);
        break;
      case 'Escape':
        if (!onClose) return;
        onClose();
        break;
      case ' ':
        // On a button Space clicks it; on the player itself it pauses.
        if (!onRoot || !auto) return;
        setPaused((p) => !p);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  if (count === 0) return null;
  const stopped = paused || held;

  return (
    <section
      className={cx(styles.viewer, className)}
      role="region"
      aria-roledescription={t('stories')}
      aria-label={label}
      tabIndex={0}
      onKeyDown={onKeyDown}
      data-paused={stopped || undefined}
      data-auto={auto || undefined}
    >
      <ol className={styles.segments} aria-hidden="true">
        {slides.map((s, i) => (
          <li key={s.id} className={styles.segment} data-state={i < index ? 'done' : i === index ? 'current' : 'next'}>
            <span
              ref={(el) => {
                barRefs.current[i] = el;
              }}
              className={styles.bar}
              style={{ transform: i < index ? 'scaleX(1)' : 'scaleX(0)' }}
            />
          </li>
        ))}
      </ol>

      <div className={styles.controls}>
        {auto ? (
          <button
            type="button"
            className={styles.round}
            aria-label={paused ? t('Continue') : t('Pause')}
            aria-pressed={paused}
            onClick={() => setPaused((p) => !p)}
          >
            <Icon name={paused ? 'play' : 'pause'} size={20} />
          </button>
        ) : null}
        {onClose ? (
          <button type="button" className={styles.round} aria-label={t('Close')} onClick={onClose}>
            <Icon name="close" size={20} />
          </button>
        ) : null}
      </div>

      <div
        className={styles.stage}
        onPointerDown={onPointerDown}
        onPointerUp={(e) => finishPress(e, false)}
        onPointerCancel={(e) => finishPress(e, true)}
        onPointerLeave={(e) => press.current && finishPress(e, true)}
      >
        <div key={slide?.id} ref={slideRef} className={styles.slide} data-slide={slide?.id}>
          {slide?.content}
        </div>
      </div>

      <button type="button" className={cx(styles.nav, styles.navPrev)} aria-label={t('Back')} onClick={prev} disabled={index === 0}>
        <Icon name="chevron-left" size={22} />
      </button>
      <button
        type="button"
        className={cx(styles.nav, styles.navNext)}
        aria-label={index === count - 1 ? t('Finish') : t('Next', undefined, 'story-viewer')}
        onClick={next}
      >
        <Icon name="chevron-right" size={22} />
      </button>

      {onExport ? (
        <button
          type="button"
          className={styles.export}
          onClick={() => slide && slideRef.current && onExport({ index, slide, element: slideRef.current })}
        >
          {exportLabel}
        </button>
      ) : null}

      <p className={styles.live} aria-live="polite" aria-atomic="true">
        {t('Slide {v} of {count}{v2}', { v: index + 1, count, v2: slide?.label ? `: ${slide.label}` : '' })}
      </p>
    </section>
  );
}
