import { DONE_MS, clamp01, smoothLevel } from './geometry';

/**
 * The orb's states:
 *   idle       slow rotation and breathing ("Нажми и говори");
 *   listening  dots follow the voice level;
 *   paused     frozen, saturation -40 %;
 *   thinking   the sphere folds into a torus in 800 ms ("Структурирую");
 *   done       the dots draw together and flash, back to a sphere ("Записано");
 *   error      like idle but drained of colour, no shimmer ("Не смог разобрать").
 */
export type OrbState = 'idle' | 'listening' | 'paused' | 'thinking' | 'done' | 'error';

export const ORB_STATES: readonly OrbState[] = ['idle', 'listening', 'paused', 'thinking', 'done', 'error'];

/** Sphere -> torus, ms (§2.7). Back to the sphere is a little quicker. */
export const MORPH_TO_TORUS_MS = 800;
export const MORPH_TO_SPHERE_MS = 600;

/** One revolution takes 90 s at rest (§2.7). */
export const SPIN_PERIOD_MS = 90_000;

/** How fast the yaw runs relative to rest: slower while listening so the shimmer is readable. */
export const SPIN_FACTOR: Record<OrbState, number> = {
  idle: 1,
  listening: 0.4,
  paused: 0,
  thinking: 1.8,
  done: 1,
  error: 0.3,
};

/** Colour saturation per state: paused -40 %, an error drains the orb further. */
export const SATURATION: Record<OrbState, number> = {
  idle: 1,
  listening: 1,
  paused: 0.6,
  thinking: 1,
  done: 1,
  error: 0.35,
};

/** Pitch of the view: a gentle tilt for the sphere, a steeper one so the hole of the torus is visible. */
export const PITCH_SPHERE = 0.32;
export const PITCH_TORUS = 1.02;

export interface OrbModel {
  /** Total animation time, ms. */
  time: number;
  /** Rotation about the vertical axis, rad. */
  yaw: number;
  /** 0 = sphere, 1 = torus, linear; the renderer eases it. */
  morph: number;
  /** Smoothed voice level 0..1 (attack 40 ms, release 220 ms). */
  level: number;
  /** The level one step ago, for peak detection. */
  previousLevel: number;
  /** Rotation speed multiplier, eased so the orb stops and starts softly. */
  spin: number;
  /** 0.35..1, eased. */
  saturation: number;
  /** ms since the orb entered `done`; Infinity when it is not (or no longer) there. */
  doneAge: number;
  state: OrbState;
}

export function createModel(state: OrbState = 'idle'): OrbModel {
  return {
    time: 0,
    yaw: 0,
    morph: state === 'thinking' ? 1 : 0,
    level: 0,
    previousLevel: 0,
    spin: SPIN_FACTOR[state],
    saturation: SATURATION[state],
    doneAge: Number.POSITIVE_INFINITY,
    state,
  };
}

const EASE_MS = 260; // spin and saturation settle over about a quarter second

const approach = (current: number, target: number, dtMs: number): number =>
  current + (target - current) * (1 - Math.exp(-dtMs / EASE_MS));

/**
 * Advances the model by `dtMs`. Mutates and returns `model` (the render loop runs it every frame and must
 * not allocate). `targetLevel` is the raw microphone level; it only counts while listening.
 */
export function stepModel(model: OrbModel, dtMs: number, state: OrbState, targetLevel: number): OrbModel {
  const dt = Math.max(0, dtMs);

  if (state !== model.state) {
    if (state === 'done') model.doneAge = 0;
    else model.doneAge = Number.POSITIVE_INFINITY;
    model.state = state;
  }

  model.time += dt;

  // Voice: only `listening` follows the microphone; every other state lets the level fall away.
  model.previousLevel = model.level;
  model.level = smoothLevel(model.level, state === 'listening' ? clamp01(targetLevel) : 0, dt);
  if (model.level < 0.001) model.level = 0;

  // Sphere <-> torus.
  if (state === 'thinking') model.morph = Math.min(1, model.morph + dt / MORPH_TO_TORUS_MS);
  else model.morph = Math.max(0, model.morph - dt / MORPH_TO_SPHERE_MS);

  // Rotation.
  model.spin = approach(model.spin, SPIN_FACTOR[state], dt);
  if (model.spin < 0.0005) model.spin = 0;
  model.yaw = (model.yaw + (dt / SPIN_PERIOD_MS) * Math.PI * 2 * model.spin) % (Math.PI * 2);

  model.saturation = approach(model.saturation, SATURATION[state], dt);

  if (Number.isFinite(model.doneAge)) {
    model.doneAge += dt;
    if (model.doneAge > DONE_MS * 2) model.doneAge = Number.POSITIVE_INFINITY;
  }
  return model;
}
