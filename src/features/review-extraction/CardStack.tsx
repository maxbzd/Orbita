import { animate, motion, useMotionValue, useTransform } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, MutableRefObject, PointerEvent } from 'react';
import type { Capture, ID, Item, Person } from '../../domain/types';
import { useReducedMotion } from '../../styles/theme';
import { Button, Caption, IconButton } from '../../ui/primitives';
import { ClarifyBlock } from './ClarifyBlock';
import { ItemCard } from './ItemCard';
import { FLY_OUT_MS, resolveSwipe, startsInsideGuard, velocityOf } from './swipe';
import type { SwipeDecision } from './swipe';
import styles from './Review.module.css';
import { t } from '../../i18n';

const SPRING_BACK = { type: 'spring', stiffness: 300, damping: 28 } as const;
const COACH_KEY = 'orbit.review.coach';

function coachSeen(): boolean {
  try {
    return localStorage.getItem(COACH_KEY) === '1';
  } catch {
    return false;
  }
}

function markCoachSeen(): void {
  try {
    localStorage.setItem(COACH_KEY, '1');
  } catch {
    // Without storage the hint simply shows again next time.
  }
}

/** Lets the buttons under the card throw it the same way a swipe does. */
interface CardControls {
  trigger(decision: SwipeDecision): void;
}

const buzz = (): void => {
  try {
    navigator.vibrate?.(8);
  } catch {
    // No vibration here.
  }
};

export interface CardStackProps {
  capture: Capture;
  /** The objects still undecided, in the order the stack was opened in. */
  items: readonly Item[];
  /** How many there were when the stack opened: the story segments. */
  total: number;
  people: ReadonlyMap<ID, Person>;
  /** The model's clarifying question, shown first. */
  question: string | undefined;
  onQuestionDone(): void;
  onAccept(item: Item): void;
  onDismiss(item: Item): void;
  onEdit(item: Item): void;
  /** Back to the list. */
  onExit(): void;
}

/**
 * «По одному»: story segments on top, a card in the middle, ✕ ✎ ✓ below. Right accepts, left dismisses, up edits; the
 * edge of the card glows in the colour of what is about to happen. Arrow keys do the same for a keyboard.
 */
export function CardStack({ capture, items, total, people, question, onQuestionDone, onAccept, onDismiss, onEdit, onExit }: CardStackProps) {
  const reduced = useReducedMotion();
  const top = items[0];
  const next = items[1];
  const decided = Math.max(0, total - items.length);
  const controls = useRef<CardControls | null>(null);
  const [coach, setCoach] = useState(() => !coachSeen());

  const decide = useCallback(
    (item: Item, decision: SwipeDecision) => {
      buzz();
      if (coach) {
        markCoachSeen();
        setCoach(false);
      }
      if (decision === 'accept') onAccept(item);
      else if (decision === 'dismiss') onDismiss(item);
      else onEdit(item);
    },
    [coach, onAccept, onDismiss, onEdit],
  );

  return (
    <section className={styles.stack} aria-label={t('Review one by one')} data-testid="card-stack">
      <header className={styles.stackHead}>
        <ol className={styles.segments} aria-hidden="true">
          {Array.from({ length: total }, (_, index) => (
            <li key={index} data-state={index < decided ? 'done' : index === decided ? 'current' : 'todo'} />
          ))}
        </ol>
        <div className={styles.stackBar}>
          <Caption>{top ? t('{min} of {total}', { min: Math.min(decided + 1, total), total }) : t('All reviewed')}</Caption>
          <Button size="sm" variant="ghost" onClick={onExit}>
            {t('To the list')}
          </Button>
        </div>
      </header>

      {question ? (
        <ClarifyBlock captureId={capture.id} question={question} onDone={onQuestionDone} variant="card" />
      ) : top ? (
        <>
          <div className={styles.deck}>
            {next ? (
              <div className={styles.peek} aria-hidden="true">
                <div className={styles.card} data-peek="" />
              </div>
            ) : null}
            <TopCard key={top.id} item={top} capture={capture} people={people} reduced={reduced} controls={controls} onDecide={(decision) => decide(top, decision)} />
            {coach ? (
              <p className={styles.coach} role="note">
                {t('Swipe right to save')}
              </p>
            ) : null}
          </div>

          <div className={styles.stackActions}>
            <IconButton icon="close" label={t('Dismiss')} variant="glass" size="lg" onClick={() => controls.current?.trigger('dismiss')} />
            <IconButton icon="edit" label={t('Edit')} variant="glass" onClick={() => controls.current?.trigger('edit')} />
            <IconButton icon="check" label={t('Accept')} variant="filled" size="lg" onClick={() => controls.current?.trigger('accept')} />
          </div>
          <p className="sr-only" role="status">
            
            {t('Card {v} of {total}: {title}', { v: decided + 1, total, title: top.title })}
          </p>
        </>
      ) : null}
    </section>
  );
}

interface DragState {
  pointerId: number;
  x0: number;
  y0: number;
  xs: Array<readonly [number, number]>;
  ys: Array<readonly [number, number]>;
}

function TopCard({
  item,
  capture,
  people,
  reduced,
  controls,
  onDecide,
}: {
  item: Item;
  capture: Capture;
  people: ReadonlyMap<ID, Person>;
  reduced: boolean;
  controls: MutableRefObject<CardControls | null>;
  onDecide(decision: SwipeDecision): void;
}) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-220, 0, 220], reduced ? [0, 0, 0] : [-7, 0, 7]);
  const okGlow = useTransform(x, [0, 96], [0, 1]);
  const noGlow = useTransform(x, [-96, 0], [1, 0]);
  const editGlow = useTransform(y, [-96, 0], [1, 0]);
  const drag = useRef<DragState | null>(null);
  const busy = useRef(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);

  const finish = useCallback(
    (decision: SwipeDecision | null) => {
      if (decision === null) {
        void animate(x, 0, reduced ? { duration: 0.12 } : SPRING_BACK);
        void animate(y, 0, reduced ? { duration: 0.12 } : SPRING_BACK);
        return;
      }
      busy.current = true;
      if (decision === 'edit') {
        // The card does not leave: the edit sheet opens over it, and the card settles back.
        void animate(x, 0, reduced ? { duration: 0.12 } : SPRING_BACK);
        void animate(y, 0, reduced ? { duration: 0.12 } : SPRING_BACK);
        busy.current = false;
        onDecide('edit');
        return;
      }
      const out = (decision === 'accept' ? 1 : -1) * (window.innerWidth + 120);
      void animate(x, out, { duration: reduced ? 0.12 : FLY_OUT_MS / 1000, ease: 'easeIn' }).then(() => onDecide(decision));
    },
    [onDecide, reduced, x, y],
  );

  useEffect(() => {
    controls.current = {
      trigger: (decision) => {
        if (!busy.current) finish(decision);
      },
    };
    return () => {
      controls.current = null;
    };
  }, [controls, finish]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (busy.current || event.button > 0) return;
    if ((event.target as HTMLElement).closest('button, a, input, textarea')) return;
    if (!startsInsideGuard(event.clientX, window.innerWidth)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, x0: event.clientX, y0: event.clientY, xs: [[event.timeStamp, 0]], ys: [[event.timeStamp, 0]] };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const dx = event.clientX - state.x0;
    const dy = event.clientY - state.y0;
    state.xs.push([event.timeStamp, dx]);
    state.ys.push([event.timeStamp, dy]);
    if (state.xs.length > 12) {
      state.xs.shift();
      state.ys.shift();
    }
    x.set(dx);
    // Pulling down only stretches the card a little; up follows the finger.
    y.set(dy < 0 ? dy : dy * 0.2);
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>): void => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    drag.current = null;
    const dx = event.clientX - state.x0;
    const dy = event.clientY - state.y0;
    finish(resolveSwipe({ dx, dy, vx: velocityOf(state.xs), vy: velocityOf(state.ys) }));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (busy.current || (event.target as HTMLElement).closest('button, a, input, textarea')) return;
    const map: Record<string, SwipeDecision> = { ArrowRight: 'accept', ArrowLeft: 'dismiss', ArrowUp: 'edit' };
    const decision = map[event.key];
    if (decision) {
      event.preventDefault();
      finish(decision);
    }
  };

  return (
    <motion.div
      ref={ref}
      className={styles.card}
      style={{ x, y, rotate }}
      initial={reduced ? false : { scale: 0.96, opacity: 0.6 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.24 }}
      tabIndex={0}
      role="group"
      aria-roledescription={t('card')}
      aria-label={item.title}
      aria-keyshortcuts="ArrowRight ArrowLeft ArrowUp"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      data-testid="top-card"
    >
      <motion.span className={styles.glowOk} style={{ opacity: okGlow }} aria-hidden="true" />
      <motion.span className={styles.glowNo} style={{ opacity: noGlow }} aria-hidden="true" />
      <motion.span className={styles.glowEdit} style={{ opacity: editGlow }} aria-hidden="true" />
      <ItemCard item={item} capture={capture} people={people} />
    </motion.div>
  );
}
