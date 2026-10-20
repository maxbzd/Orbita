import type { IconName } from '../icons';
import { t } from '../../i18n';

/**
 * Where the navigation can lead. Four sections live in the phone pill and the tablet rail; "Люди",
 * "Паттерны" and "Обзоры" live inside "Орбита" and get their own entries only in the desktop sidebar
 *.
 */
export type Section = 'today' | 'stream' | 'orbit' | 'me';
export type Destination = Section | 'people' | 'patterns' | 'reviews';

export interface NavDestination {
  id: Destination;
  label: string;
  icon: IconName;
  /** Route path (router-relative). */
  to: string;
  section: Section;
}

/** Pill order: Сегодня · Поток · [сфера] · Орбита · Я. */
export const SECTIONS: readonly NavDestination[] = [
  { id: 'today', get label() { return t('Today') }, icon: 'today', to: '/today', section: 'today' },
  { id: 'stream', get label() { return t('Stream') }, icon: 'stream', to: '/stream', section: 'stream' },
  { id: 'orbit', get label() { return t('Orbita') }, icon: 'orbit', to: '/orbit', section: 'orbit' },
  { id: 'me', get label() { return t('Me') }, icon: 'me', to: '/me', section: 'me' },
];

/** Secondary entries of the desktop sidebar. */
export const ORBIT_LINKS: readonly NavDestination[] = [
  { id: 'people', get label() { return t('People') }, icon: 'people', to: '/people', section: 'orbit' },
  { id: 'patterns', get label() { return t('Patterns') }, icon: 'pattern', to: '/patterns', section: 'orbit' },
  { id: 'reviews', get label() { return t('Reviews') }, icon: 'review', to: '/reviews', section: 'orbit' },
];

const BY_FIRST_SEGMENT: Record<string, Destination> = {
  today: 'today',
  checkin: 'today',
  stream: 'stream',
  entry: 'stream',
  review: 'stream', // the review of one capture ("ИИ достал N объектов") belongs to the stream
  ask: 'stream',
  orbit: 'orbit',
  items: 'orbit',
  people: 'people',
  patterns: 'patterns',
  reviews: 'reviews',
  me: 'me',
  settings: 'me',
  context: 'me',
};

/** The destination a path belongs to, or null (onboarding, capture, unknown). */
export function destinationForPath(pathname: string): Destination | null {
  const first = pathname.split('/').filter(Boolean)[0];
  return first ? (BY_FIRST_SEGMENT[first] ?? null) : null;
}

/** People, patterns and reviews highlight "Орбита" in the four-item navigation. */
export function sectionOf(destination: Destination | null): Section | null {
  if (!destination) return null;
  return destination === 'people' || destination === 'patterns' || destination === 'reviews' ? 'orbit' : destination;
}

/** A link as the navigation components render it. */
export interface NavLinkItem {
  id: string;
  label: string;
  icon: IconName;
  /** Real URL (hash router: "#/today"), so middle-click and "open in new tab" work. */
  href: string;
}

/** A recent entry for the sidebar's "Недавние". */
export interface RecentItem {
  id: string;
  title: string;
  subtitle?: string;
  href: string;
}
