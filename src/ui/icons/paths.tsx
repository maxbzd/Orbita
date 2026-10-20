import type { ReactNode } from 'react';

/**
 * Icon geometry: 24x24 grid, outline only, drawn with a 1.5 px round stroke in `currentColor`
 *. Keep every glyph inside the 3..21 safe area.
 */

/** Closed polar outline r(t) = R * (1 + a * cos(k * t)): the "state" flower. */
function polarPath(cx: number, cy: number, radius: number, amplitude: number, lobes: number, steps = 60): string {
  const points: string[] = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2 - Math.PI / 2;
    const r = radius * (1 + amplitude * Math.cos(lobes * (t + Math.PI / 2)));
    points.push(`${(cx + r * Math.cos(t)).toFixed(2)} ${(cy + r * Math.sin(t)).toFixed(2)}`);
  }
  return `M${points.join('L')}Z`;
}

export const ICONS = {
  // ── navigation
  today: (
    <>
      <circle cx="12" cy="12" r="4.6" />
      <path d="M13.6 7.9A9.5 3.4 -20 1 1 8.2 9.9" />
    </>
  ),
  stream: (
    <>
      <path d="M3 8.5c2.3-2.5 4.4 2.5 6.8 0s4.5 2.5 6.8 0 3.2 1.1 4.4 0" />
      <path d="M3 15.5c2.3-2.5 4.4 2.5 6.8 0s4.5 2.5 6.8 0 3.2 1.1 4.4 0" />
    </>
  ),
  orbit: (
    <>
      <circle cx="12" cy="12" r="2.4" />
      <ellipse cx="12" cy="12" rx="9.2" ry="4.2" transform="rotate(-28 12 12)" />
      <circle cx="19.4" cy="8.1" r="1.2" />
    </>
  ),
  me: (
    <>
      <circle cx="12" cy="8.5" r="3.6" />
      <path d="M5 20c.8-3.7 3.5-5.7 7-5.7s6.2 2 7 5.7" />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="8.5" r="3.3" />
      <path d="M3 19.5c.7-3.4 3-5.2 6-5.2s5.3 1.8 6 5.2" />
      <path d="M15.5 5.6a3.2 3.2 0 0 1 0 5.8" />
      <path d="M17.6 14.6c1.8.6 2.9 2.2 3.4 4.9" />
    </>
  ),
  review: (
    <>
      <rect x="5.5" y="3" width="13" height="18" rx="2.5" />
      <path d="M12 8c.3 2 1.2 2.9 3.2 3.2-2 .3-2.9 1.2-3.2 3.2-.3-2-1.2-2.9-3.2-3.2 2-.3 2.9-1.2 3.2-3.2z" />
      <path d="M9 18h6" />
    </>
  ),

  // ── actions
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11.2a6.5 6.5 0 0 0 13 0" />
      <path d="M12 17.7V21" />
      <path d="M9 21h6" />
    </>
  ),
  text: (
    <>
      <path d="M5 7V5.2h14V7" />
      <path d="M12 5.2v13.6" />
      <path d="M9.3 18.8h5.4" />
    </>
  ),
  pause: (
    <>
      <rect x="6" y="5" width="4" height="14" rx="1.2" />
      <rect x="14" y="5" width="4" height="14" rx="1.2" />
    </>
  ),
  stop: <rect x="6" y="6" width="12" height="12" rx="2.5" />,
  play: <path d="M8 5.6v12.8a1 1 0 0 0 1.5.86l10.2-6.4a1 1 0 0 0 0-1.72L9.5 4.74A1 1 0 0 0 8 5.6z" />,
  check: <path d="M5 12.6l4.6 4.6L19 7.6" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="10.8" cy="10.8" r="6.6" />
      <path d="M15.7 15.7L20.5 20.5" />
    </>
  ),
  ask: (
    <>
      <path d="M5 4.5h14a2 2 0 0 1 2 2v8.2a2 2 0 0 1-2 2h-6.6L8 20.2v-3.5H5a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2z" />
      <path d="M12 7.8c.3 1.7 1.1 2.5 2.8 2.8-1.7.3-2.5 1.1-2.8 2.8-.3-1.7-1.1-2.5-2.8-2.8 1.7-.3 2.5-1.1 2.8-2.8z" />
    </>
  ),
  edit: (
    <>
      <path d="M4 20h4.2L19.4 8.8a2.9 2.9 0 0 0-4.2-4.2L4 15.8z" />
      <path d="M13.6 6.2l4.2 4.2" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M9 7V4.5h6V7" />
      <path d="M6.5 7l.8 12a2 2 0 0 0 2 1.8h5.4a2 2 0 0 0 2-1.8L17.5 7" />
      <path d="M10 11v5.5M14 11v5.5" />
    </>
  ),
  link: (
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </>
  ),
  share: (
    <>
      <path d="M12 15.5V4" />
      <path d="M8 7.8l4-4 4 4" />
      <path d="M5 12v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
    </>
  ),
  import: (
    <>
      <path d="M12 4v11" />
      <path d="M7.5 11L12 15.5 16.5 11" />
      <path d="M5 19.5h14" />
    </>
  ),
  more: (
    <>
      <circle cx="5.5" cy="12" r="1.3" />
      <circle cx="12" cy="12" r="1.3" />
      <circle cx="18.5" cy="12" r="1.3" />
    </>
  ),
  'chevron-right': <path d="M9.5 5.5L16 12l-6.5 6.5" />,
  'chevron-left': <path d="M14.5 5.5L8 12l6.5 6.5" />,
  'chevron-up': <path d="M5.5 14.5L12 8l6.5 6.5" />,
  'chevron-down': <path d="M5.5 9.5L12 16l6.5-6.5" />,

  // ── places and states
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
      <path d="M12 14.8v2.2" />
    </>
  ),
  flame: (
    <>
      <path d="M12 21a6 6 0 0 0 6-6c0-3.4-2.3-5-3.4-7.3-.5-1-.8-2.2-.9-3.7C10.5 5.6 6 8.7 6 15a6 6 0 0 0 6 6z" />
      <path d="M12 21a2.6 2.6 0 0 1-2.6-2.6c0-1.8 1.5-2.4 2.6-4.2 1.1 1.8 2.6 2.4 2.6 4.2A2.6 2.6 0 0 1 12 21z" />
    </>
  ),
  alert: (
    <>
      <path d="M10.3 4.9L2.9 18a2 2 0 0 0 1.7 3h14.8a2 2 0 0 0 1.7-3L13.7 4.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9.5v4.2M12 17.2h.01" />
    </>
  ),
  moon: <path d="M20 14.6A8.5 8.5 0 1 1 9.4 4a6.7 6.7 0 0 0 10.6 10.6z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="3.8" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" />
    </>
  ),
  sunrise: (
    <>
      <path d="M7.5 16.5a4.5 4.5 0 0 1 9 0" />
      <path d="M3 20h18M12 4.5v3.5M8.5 6.8L10 8.4M15.5 6.8L14 8.4" />
    </>
  ),
  sunset: (
    <>
      <path d="M7.5 16.5a4.5 4.5 0 0 1 9 0" />
      <path d="M3 20h18M12 8V4.5M9.7 6.3L12 8.6l2.3-2.3" />
    </>
  ),

  // ── record types: each has its own glyph, because colour alone must not carry the meaning
  decision: (
    <>
      <path d="M12 21v-8.4" />
      <path d="M12 12.6c0-3.6-5.6-3.2-5.6-7.2" />
      <path d="M12 12.6c0-3.6 5.6-3.2 5.6-7.2" />
      <circle cx="6.4" cy="4.4" r="1.3" />
      <circle cx="17.6" cy="4.4" r="1.3" />
    </>
  ),
  commitment: (
    <>
      <circle cx="8.7" cy="12" r="5.7" />
      <circle cx="15.3" cy="12" r="5.7" />
    </>
  ),
  idea: <path d="M12 3c.7 5.2 3.8 8.3 9 9-5.2.7-8.3 3.8-9 9-.7-5.2-3.8-8.3-9-9 5.2-.7 8.3-3.8 9-9z" />,
  prediction: (
    <>
      <path d="M3.5 19.5C6 11.5 11 7.2 17.8 6.5" />
      <circle cx="19.6" cy="6.3" r="1.7" />
      <path d="M3.5 19.5h.01" />
    </>
  ),
  task: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="4.2" />
      <path d="M8.4 12.3l2.5 2.5 4.7-5" />
    </>
  ),
  question: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.6a2.5 2.5 0 0 1 4.9.7c0 1.7-2.5 2.2-2.5 3.9" />
      <path d="M12 17.2h.01" />
    </>
  ),
  lesson: (
    <>
      <path d="M12 6.8c-1.8-1.6-4.3-2.2-8-2.2V17c3.7 0 6.2.6 8 2.2 1.8-1.6 4.3-2.2 8-2.2V4.6c-3.7 0-6.2.6-8 2.2z" />
      <path d="M12 6.8v12.4" />
    </>
  ),
  fact: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.4M12 7.7h.01" />
    </>
  ),
  state: <path d={polarPath(12, 12, 6.6, 0.3, 5)} />,
  person: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.2A8.8 8.8 0 1 0 20.8 12" />
      <circle cx="18.2" cy="5.8" r="1.3" />
    </>
  ),
  project: <path d="M3.5 7.5a2 2 0 0 1 2-2h4l2.1 2.5h6.9a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />,
  pattern: (
    <>
      <circle cx="5" cy="17" r="1.8" />
      <circle cx="11" cy="8" r="1.8" />
      <circle cx="19" cy="15" r="1.8" />
      <path d="M6 15.5L10 9.5M12.4 9.2l5.3 4.6" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof ICONS;

export const ICON_NAMES = Object.keys(ICONS) as IconName[];
