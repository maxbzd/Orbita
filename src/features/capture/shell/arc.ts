import type { IconName } from '../../../ui/icons';
import { t } from '../../../i18n';

/**
 * The arc of four actions that opens over a held sphere: radius 96,
 * angles -150, -110, -70 and -30 degrees (0 is to the right, negative is up), targets 56 px.
 */

export type SphereActionId = 'text' | 'checkin' | 'import' | 'quick';

export interface SphereAction {
  id: SphereActionId;
  label: string;
  /** A sentence for the sheet fallback and screen readers. */
  hint: string;
  icon: IconName;
  /** Degrees from the sphere's centre. */
  angle: number;
}

export const ARC_ACTIONS: readonly SphereAction[] = [
  { id: 'text', get label() { return t('Text') }, get hint() { return t('Write a thought instead of speaking') }, icon: 'text', angle: -150 },
  { id: 'checkin', get label() { return t('State') }, get hint() { return t('Note how you are now') }, icon: 'state', angle: -110 },
  { id: 'import', get label() { return t('Import an AI conversation') }, get hint() { return t('Paste a conversation with ChatGPT or Claude') }, icon: 'import', angle: -70 },
  { id: 'quick', get label() { return t('Quick thought') }, get hint() { return t('One line without recording voice') }, icon: 'idea', angle: -30 },
];

export const ARC_RADIUS = 96;
/** Touch target of a satellite. */
export const ARC_TARGET = 56;
/** A finger within this distance of a satellite's centre selects it (a little more than the target's radius). */
export const ARC_REACH = 40;
/** Keep satellites this far from the screen edge. */
const EDGE = 8;

export interface Point {
  x: number;
  y: number;
}

export interface Satellite {
  action: SphereAction;
  x: number;
  y: number;
}

/**
 * Where the satellites sit, as viewport coordinates. On a narrow phone the outer two would leave the
 * screen when the sphere is off-centre, so each is pushed back inside.
 */
export function arcPositions(origin: Point, viewport: { width: number; height: number }, radius: number = ARC_RADIUS): Satellite[] {
  const half = ARC_TARGET / 2;
  return ARC_ACTIONS.map((action) => {
    const radians = (action.angle * Math.PI) / 180;
    const x = origin.x + Math.cos(radians) * radius;
    const y = origin.y + Math.sin(radians) * radius;
    return {
      action,
      x: Math.min(Math.max(x, EDGE + half), viewport.width - EDGE - half),
      y: Math.min(Math.max(y, EDGE + half), viewport.height - EDGE - half),
    };
  });
}

/** The satellite under the finger, or null when it is elsewhere. The nearest one wins when reaches overlap. */
export function satelliteAt(satellites: readonly Satellite[], point: Point, reach: number = ARC_REACH): SphereActionId | null {
  let best: { id: SphereActionId; distance: number } | null = null;
  for (const satellite of satellites) {
    const distance = Math.hypot(satellite.x - point.x, satellite.y - point.y);
    if (distance <= reach && (best === null || distance < best.distance)) best = { id: satellite.action.id, distance };
  }
  return best?.id ?? null;
}
