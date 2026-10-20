import { forwardRef } from 'react';
import { formatDayShort } from '../../domain/dates';
import type { DayKey } from '../../domain/types';
import { cx } from '../primitives/cx';
import { flowerPath } from '../viz/flower';
import { useSvgId } from '../viz/hooks';
import { moodHex, moodWord } from '../viz/mood';
import { barcodeBars, fitFontSize, GLYPH_RATIO } from './geometry';
import { ObjectFrame } from './ObjectFrame';
import type { ObjectBaseProps } from './ObjectFrame';
import styles from './objects.module.css';
import { t } from '../../i18n';

export interface TicketStat {
  /** Short caps label, up to ~9 characters ("ОБЕЩАНИЙ"). */
  label: string;
  value: number | string;
}

export interface TicketProps extends ObjectBaseProps {
  date: DayKey;
  /** State in the morning and in the evening, −3…+3. Null/undefined: not recorded. */
  from?: number | null;
  to?: number | null;
  /** The dominant number of the day and what it counts. */
  hero: { value: number | string; label: string };
  /** Up to three smaller numbers on the stub. */
  stats?: readonly TicketStat[];
  /** The service line under the hero. Default: built from the date. */
  serviceLine?: string;
  /** Text the barcode is derived from. Default: the date, the hero and the stats. */
  seed?: string;
}

const W = 360;
const H = 240;
const STUB_X = 258;
const NOTCH = 10;

function MoodEnd({ x, value, caption }: { x: number; value: number | null | undefined; caption: string }) {
  const known = typeof value === 'number' && Number.isFinite(value);
  return (
    <g>
      <text x={x} y="62" fontSize="11" className={cx(styles.label, styles.ink2)}>
        {caption}
      </text>
      {known ? (
        <>
          <path d={flowerPath(value, { size: 30, cx: x + 15, cy: 80 })} fill={moodHex(value)} />
          <text x={x + 38} y="85" fontSize="14" className={cx(styles.displayItalic, styles.ink)}>
            {moodWord(value)}
          </text>
        </>
      ) : (
        <text x={x} y="85" fontSize="14" className={cx(styles.displayItalic, styles.ink3)}>
          {t('not logged')}
        </text>
      )}
    </g>
  );
}

/**
 * The day ticket (docs §2.9): 3:2, notches cut with a mask, a dashed tear line, "FROM → TO" state (morning → evening),
 * one dominant number and a mono service line; the stub carries three numbers and a decorative barcode from a hash.
 */
export const Ticket = forwardRef<SVGSVGElement, TicketProps>(function Ticket(
  { date, from, to, hero, stats = [], serviceLine, seed, onSave, saveLabel, maxWidth, className },
  ref,
) {
  const id = useSvgId('ticket');
  const heroText = String(hero.value);
  const heroSize = Math.min(72, fitFontSize(heroText, 150, { ratio: GLYPH_RATIO.mono, min: 28, max: 72 }));
  const shown = stats.slice(0, 3);
  const dayText = formatDayShort(date, { withYear: true })
    .replace(/\s*г\.$/, '')
    .toUpperCase();
  const service = serviceLine ?? t('TICKET OF THE DAY · {date}', { date });
  const code = barcodeBars(seed ?? `${date}|${heroText}|${shown.map((s) => s.value).join(',')}`, 72, 20);

  const fromWord = typeof from === 'number' ? moodWord(from) : t('not logged');
  const toWord = typeof to === 'number' ? moodWord(to) : t('not logged');
  const label = t('Summary of the day, {dayText}: {label} {heroText}. Morning: {fromWord}, evening: {toWord}.{v}', { dayText, label: hero.label, heroText, fromWord, toWord, v: shown.map((s) => ` ${s.label.toLowerCase()}: ${s.value}.`).join('') });

  return (
    <ObjectFrame
      ref={ref}
      viewBox={`0 0 ${W} ${H}`}
      label={label}
      onSave={onSave}
      saveLabel={saveLabel}
      maxWidth={maxWidth}
      className={className}
    >
      <defs>
        <mask id={`${id}-cut`}>
          <rect width={W} height={H} rx="18" fill="#fff" />
          <circle cx={STUB_X} cy="0" r={NOTCH} fill="#000" />
          <circle cx={STUB_X} cy={H} r={NOTCH} fill="#000" />
        </mask>
      </defs>
      <g mask={`url(#${id}-cut)`}>
        <rect width={W} height={H} className={styles.cardFill} />
        <rect x={STUB_X} width={W - STUB_X} height={H} className={styles.stubFill} />
      </g>
      <line x1={STUB_X} y1={NOTCH + 6} x2={STUB_X} y2={H - NOTCH - 6} className={styles.dashed} />

      <text x="22" y="34" fontSize="11" className={cx(styles.label, styles.ink2)}>
        {dayText}
      </text>
      <MoodEnd x={22} value={from} caption={t('FROM')} />
      <text x="140" y="80" fontSize="18" textAnchor="middle" className={cx(styles.mono, styles.ink3)} aria-hidden="true">
        →
      </text>
      <MoodEnd x={158} value={to} caption={t('TO')} />

      <text x="22" y={158 + heroSize * 0.3} fontSize={heroSize} className={cx(styles.mono, styles.ink)}>
        {heroText}
      </text>
      <text x="22" y="198" fontSize="13" className={cx(styles.sans, styles.ink2)}>
        {hero.label}
      </text>
      <text x="22" y="222" fontSize="11" className={cx(styles.label, styles.ink3)}>
        {service}
      </text>

      {shown.map((stat, i) => (
        <g key={`${stat.label}-${i}`}>
          <text x={STUB_X + 18} y={38 + i * 42} fontSize="11" className={cx(styles.label, styles.ink2)}>
            {stat.label}
          </text>
          <text x={STUB_X + 18} y={62 + i * 42} fontSize="22" className={cx(styles.mono, styles.ink)}>
            {String(stat.value)}
          </text>
        </g>
      ))}
      <g transform={`translate(${STUB_X + 18} ${H - 48})`} aria-hidden="true">
        {code.map((bar, i) => (
          <rect key={i} x={bar.x} y="0" width={bar.width} height="26" className={styles.barcode} />
        ))}
      </g>
    </ObjectFrame>
  );
});
