import { forwardRef } from 'react';
import { cx } from '../primitives/cx';
import { TYPE_LABELS, typeColor } from '../primitives/kinds';
import type { TypeKind } from '../primitives/kinds';
import { useSvgId } from '../viz/hooks';
import { fitParagraph, starPath } from './geometry';
import { ObjectFrame } from './ObjectFrame';
import type { ObjectBaseProps } from './ObjectFrame';
import styles from './objects.module.css';

export interface InsightStarProps extends ObjectBaseProps {
  /** The insight itself, in the second person, one or two sentences. */
  phrase: string;
  /** Type colour and caption. Default: pattern. */
  kind?: TypeKind;
  /** Small caps line under the star. Default: the type's name. */
  caption?: string;
  /** Small caps line at the top (a date or "ПОДТВЕРЖДЕНО"). */
  eyebrow?: string;
  /** Plays the one-time "reveal" (blur 8 → 0 over 600 ms; off under reduced motion). */
  reveal?: boolean;
}

const W = 300;
const H = 400;
const CX = 150;
const CY = 198;
const OUTER = 148;
const INNER_SHARE = 0.62;

/**
 * The insight star (docs §2.2, §2.9): a plump five-ray star with rounded rays and the phrase inside, on a 3:4 card.
 * The phrase is set in the serif "thought" voice and fitted into the star's inner circle.
 */
export const InsightStar = forwardRef<SVGSVGElement, InsightStarProps>(function InsightStar(
  { phrase, kind = 'pattern', caption, eyebrow, reveal = false, onSave, saveLabel, maxWidth, className },
  ref,
) {
  const id = useSvgId('star');
  const color = typeColor(kind);
  const inner = OUTER * INNER_SHARE;
  // A box that fits inside the valley circle, a little narrower than its diameter.
  const boxW = inner * 1.72;
  const boxH = inner * 1.3;
  const text = fitParagraph(phrase, boxW, boxH, { sizes: [24, 22, 20, 18, 16, 14, 13], lineHeight: 1.28 });
  const blockH = text.lines.length * text.fontSize * text.lineHeight;
  const top = CY - blockH / 2 + text.fontSize * 0.95;
  const label = caption ?? TYPE_LABELS[kind].toUpperCase();

  return (
    <ObjectFrame
      ref={ref}
      viewBox={`0 0 ${W} ${H}`}
      label={`${TYPE_LABELS[kind]}: ${phrase}`}
      onSave={onSave}
      saveLabel={saveLabel}
      maxWidth={maxWidth}
      className={className}
      svgClassName={cx(reveal && styles.reveal)}
    >
      <defs>
        <radialGradient id={`${id}-glow`} cx="50%" cy="46%" r="60%">
          <stop offset="0" style={{ stopColor: color }} stopOpacity="0.28" />
          <stop offset="1" style={{ stopColor: color }} stopOpacity="0.06" />
        </radialGradient>
      </defs>
      <rect x="0.5" y="0.5" width={W - 1} height={H - 1} rx="24" className={styles.cardFill} />
      <rect x="0.5" y="0.5" width={W - 1} height={H - 1} rx="24" className={styles.cardStroke} />
      <path
        d={starPath(CX, CY, OUTER, { inner: INNER_SHARE })}
        fill={`url(#${id}-glow)`}
        style={{ stroke: color }}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d={starPath(CX, CY, OUTER - 9, { inner: INNER_SHARE })}
        fill="none"
        style={{ stroke: color }}
        strokeOpacity="0.35"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      {eyebrow ? (
        <text x={CX} y="30" textAnchor="middle" fontSize="11" className={cx(styles.label, styles.ink2)}>
          {eyebrow}
        </text>
      ) : null}
      <text textAnchor="middle" fontSize={text.fontSize} className={cx(styles.serif, styles.ink)}>
        {text.lines.map((line, i) => (
          <tspan key={i} x={CX} y={top + i * text.fontSize * text.lineHeight}>
            {line}
          </tspan>
        ))}
      </text>
      <circle cx={CX + 2 - label.length * 3.95 - 10} cy={H - 30} r="4" style={{ fill: color }} />
      <text x={CX + 2} y={H - 26} textAnchor="middle" fontSize="11" className={cx(styles.label, styles.ink)}>
        {label}
      </text>
    </ObjectFrame>
  );
});
