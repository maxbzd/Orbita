import { forwardRef } from 'react';
import type { ReactNode } from 'react';
import { ObjectFrame, Passport, Poster, Ticket, fitFontSize, flowerPath, GLYPH_RATIO, moodHex, wrapLines } from '../../ui';
import type { ObjectBaseProps } from '../../ui';
import { useSvgId } from '../../ui/viz/hooks';
import type { SlideGroup, SlideSpec, SlideStat } from './model';
import styles from './slides.module.css';
import { t } from '../../i18n';

/**
 * The cards of a story, drawn as SVG so that "Сохранить картинку" exports exactly what is on screen. Fixed night colours:
 * an object is the same in both themes. The glass card is a translucent plate;
 * a real blur cannot be exported, a plate can.
 */

const W = 360;
const H = 640;
const PAD = 24;
const INNER = W - PAD * 2;
const INK = '#F2EDDC';
const INK_2 = '#B6BBD3';
const INK_3 = '#7F86A8';
const CARD_BOTTOM = 596;

interface FrameProps extends ObjectBaseProps {
  label: string;
  glow: number;
  /** A second light, from the bottom: indigo by default. */
  accent?: string;
  children: ReactNode;
}

const SlideFrame = forwardRef<SVGSVGElement, FrameProps>(function SlideFrame({ label, glow, accent = '#4B4FD8', children, ...rest }, ref) {
  const id = useSvgId('slide');
  const light = moodHex(glow);
  return (
    <ObjectFrame ref={ref} viewBox={`0 0 ${W} ${H}`} label={label} {...rest}>
      <defs>
        <radialGradient id={`${id}-a`} cx="85%" cy="6%" r="80%">
          <stop offset="0" stopColor={light} stopOpacity="0.5" />
          <stop offset="1" stopColor={light} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-b`} cx="8%" cy="100%" r="85%">
          <stop offset="0" stopColor={accent} stopOpacity="0.45" />
          <stop offset="1" stopColor={accent} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width={W} height={H} rx="20" fill="#07080F" />
      <rect width={W} height={H} rx="20" fill={`url(#${id}-a)`} />
      <rect width={W} height={H} rx="20" fill={`url(#${id}-b)`} />
      {children}
    </ObjectFrame>
  );
});

function Eyebrow({ text }: { text: string }) {
  return (
    <text x={PAD} y={PAD + 30} fontSize="11" fill={INK_2} className={styles.label}>
      {text.length > 40 ? `${text.slice(0, 39)}…` : text}
    </text>
  );
}

function Glass({ x = PAD, y, width = INNER, height }: { x?: number; y: number; width?: number; height: number }) {
  return <rect x={x} y={y} width={width} height={height} rx="20" fill="#F2EDDC" fillOpacity="0.07" stroke="#F2EDDC" strokeOpacity="0.16" />;
}

/** Title in the display face, wrapped; returns the baseline of the line after the last one. */
function Title({ text, y, size = 30, maxLines = 3 }: { text: string; y: number; size?: number; maxLines?: number }) {
  const { lines } = wrapLines(text, INNER, size, { ratio: 0.46, maxLines });
  return (
    <>
      <text fontSize={size} fill={INK} className={styles.display}>
        {lines.map((line, i) => (
          <tspan key={i} x={PAD} y={y + i * (size + 5)}>
            {line}
          </tspan>
        ))}
      </text>
    </>
  );
}

function titleLinesCount(text: string, size: number, maxLines: number): number {
  return wrapLines(text, INNER, size, { ratio: 0.46, maxLines }).lines.length;
}

// ───────── Numbers ─────────

function MetricCell({ stat, x, y }: { stat: SlideStat; x: number; y: number }) {
  const long = [...stat.value].length > 8;
  const size = long ? Math.max(13, Math.min(18, fitFontSize(stat.value, 126, { ratio: GLYPH_RATIO.sans, min: 12, max: 18 }))) : 24;
  return (
    <g>
      <text x={x} y={y} fontSize="10" fill={INK_2} className={styles.label}>
        {stat.label.length > 20 ? `${stat.label.slice(0, 19)}…` : stat.label}
      </text>
      <text x={x} y={y + 26} fontSize={size} fill={INK} className={long ? styles.sans : styles.mono}>
        {stat.value}
      </text>
    </g>
  );
}

function MetricsSlide({ spec, ...rest }: { spec: Extract<SlideSpec, { type: 'metrics' }> } & ObjectBaseProps) {
  const lines = titleLinesCount(spec.title, 28, 3);
  const titleY = PAD + 76;
  const heroSize = Math.min(104, fitFontSize(spec.hero.value, 230, { ratio: GLYPH_RATIO.poster, min: 40, max: 104 }));
  const heroTop = titleY + (lines - 1) * 33 + 30;
  const heroBase = heroTop + heroSize * 0.78;
  const cardTop = heroBase + 52;
  const rows = Math.ceil(spec.metrics.length / 2);
  const compareH = spec.compare ? 92 : 0;
  const cardH = Math.min(CARD_BOTTOM - cardTop, 28 + rows * 58 + compareH);
  const maxBar = Math.max(1, spec.compare?.now ?? 0, spec.compare?.before ?? 0);
  const barWidth = (value: number): number => Math.max(3, (value / maxBar) * (INNER - 40 - 92));
  const compareTop = cardTop + 20 + rows * 58;

  return (
    <SlideFrame label={spec.label} glow={spec.glow} {...rest}>
      <Eyebrow text={spec.eyebrow} />
      <Title text={spec.title} y={titleY} size={28} />
      <text x={PAD} y={heroBase} fontSize={heroSize} fill={INK} className={styles.poster}>
        {spec.hero.value}
      </text>
      <text x={PAD} y={heroBase + 24} fontSize="11" fill={INK_2} className={styles.label}>
        {spec.hero.label}
      </text>
      <Glass y={cardTop} height={cardH} />
      {spec.metrics.map((stat, i) => (
        <MetricCell key={`${stat.label}-${i}`} stat={stat} x={PAD + 20 + (i % 2) * 150} y={cardTop + 34 + Math.floor(i / 2) * 58} />
      ))}
      {spec.compare ? (
        <g>
          <line x1={PAD + 20} x2={W - PAD - 20} y1={compareTop - 6} y2={compareTop - 6} stroke={INK} strokeOpacity="0.16" />
          <text x={PAD + 20} y={compareTop + 12} fontSize="10" fill={INK_2} className={styles.label}>
            {spec.compare.caption}
          </text>
          {[
            { label: spec.compare.nowLabel, value: spec.compare.now, fill: INK },
            { label: spec.compare.beforeLabel, value: spec.compare.before, fill: INK_3 },
          ].map((row, i) => (
            <g key={row.label}>
              <text x={PAD + 20} y={compareTop + 36 + i * 22} fontSize="12" fill={INK_2} className={styles.sans}>
                {row.label}
              </text>
              <rect x={PAD + 92} y={compareTop + 26 + i * 22} width={barWidth(row.value)} height="10" rx="5" fill={row.fill} fillOpacity={i === 0 ? 0.95 : 0.55} />
              <text x={PAD + 92 + barWidth(row.value) + 8} y={compareTop + 36 + i * 22} fontSize="12" fill={INK} className={styles.mono}>
                {row.value}
              </text>
            </g>
          ))}
        </g>
      ) : null}
    </SlideFrame>
  );
}

// ───────── Lists ─────────

function ListSlide({ spec, ...rest }: { spec: Extract<SlideSpec, { type: 'list' }> } & ObjectBaseProps) {
  const titleSize = 30;
  const titleLines = titleLinesCount(spec.title, titleSize, 2);
  let y = PAD + 76 + (titleLines - 1) * (titleSize + 5) + 40;
  const limit = spec.footer ? 560 : 590;
  let hidden = 0;
  const blocks: ReactNode[] = [];
  spec.groups.forEach((group: SlideGroup, g) => {
    if (group.title) {
      blocks.push(
        <text key={`t${g}`} x={PAD} y={y} fontSize="11" fill={INK_2} className={styles.label}>
          {group.title}
        </text>,
      );
      y += 24;
    }
    group.items.forEach((item, i) => {
      const { lines } = wrapLines(item, INNER - 18, 16, { ratio: 0.54, maxLines: 4 });
      const height = lines.length * 22 + 14;
      if (y + height > limit) {
        hidden += 1;
        return;
      }
      blocks.push(
        <g key={`${g}-${i}`}>
          <circle cx={PAD + 4} cy={y - 5} r="3" fill={moodHex(spec.glow)} />
          <text fontSize="16" fill={INK} className={styles.serif}>
            {lines.map((line, k) => (
              <tspan key={k} x={PAD + 18} y={y + k * 22}>
                {line}
              </tspan>
            ))}
          </text>
        </g>,
      );
      y += height;
    });
    y += 10;
  });
  const footer = [spec.footer, hidden > 0 ? t('And {hidden} more', { hidden }) : undefined].filter(Boolean).join(' · ');

  return (
    <SlideFrame label={spec.label} glow={spec.glow} {...rest}>
      <Eyebrow text={spec.eyebrow} />
      <Title text={spec.title} y={PAD + 76} size={titleSize} maxLines={2} />
      {blocks}
      {footer ? (
        <text x={PAD} y={CARD_BOTTOM} fontSize="10" fill={INK_2} className={styles.label}>
          {footer.length > 44 ? `${footer.slice(0, 43)}…` : footer}
        </text>
      ) : null}
    </SlideFrame>
  );
}

// ───────── A phrase ─────────

function TextSlide({ spec, ...rest }: { spec: Extract<SlideSpec, { type: 'text' }> } & ObjectBaseProps) {
  const sizes = [34, 30, 27, 24, 22, 20, 18];
  let chosen = { size: 18, lines: [] as string[] };
  for (const size of sizes) {
    const maxLines = Math.floor(400 / (size * 1.22));
    const { lines, truncated } = wrapLines(spec.body, INNER, size, { ratio: 0.46, maxLines });
    chosen = { size, lines };
    if (!truncated) break;
  }
  return (
    <SlideFrame label={spec.label} glow={spec.glow} {...rest}>
      <Eyebrow text={spec.eyebrow} />
      <text x={PAD} y={PAD + 90} fontSize="64" fill={INK} fillOpacity="0.35" className={styles.poster} aria-hidden="true">
        “
      </text>
      <text fontSize={chosen.size} fill={INK} className={styles.displayItalic}>
        {chosen.lines.map((line, i) => (
          <tspan key={i} x={PAD} y={PAD + 150 + i * chosen.size * 1.22}>
            {line}
          </tspan>
        ))}
      </text>
      <text x={PAD} y={CARD_BOTTOM} fontSize="10" fill={INK_2} className={styles.label}>
        {spec.title.length > 40 ? `${spec.title.slice(0, 39)}…` : spec.title}
      </text>
    </SlideFrame>
  );
}

// ───────── Mood ─────────

function binPoints(points: readonly number[], max: number): number[] {
  if (points.length <= max) return [...points];
  const size = points.length / max;
  return Array.from({ length: max }, (_, i) => {
    const part = points.slice(Math.floor(i * size), Math.max(Math.floor(i * size) + 1, Math.floor((i + 1) * size)));
    return part.reduce((a, b) => a + b, 0) / part.length;
  });
}

function MoodSlide({ spec, ...rest }: { spec: Extract<SlideSpec, { type: 'mood' }> } & ObjectBaseProps) {
  const bins = binPoints(spec.points, 12);
  const step = bins.length > 1 ? INNER / bins.length : INNER;
  const size = Math.min(34, step - 4);
  const hasMood = bins.length > 0;
  const rowY = PAD + 150;
  const lines = spec.lines.flatMap((line) => wrapLines(line, INNER - 40, 13, { ratio: 0.56, maxLines: 3 }).lines.concat(['']));
  const shownLines = lines.slice(0, 15);
  const cardTop = hasMood ? rowY + 100 : PAD + 100;
  const cardH = Math.min(CARD_BOTTOM - cardTop, 28 + shownLines.length * 18);

  return (
    <SlideFrame label={spec.label} glow={spec.glow} {...rest}>
      <Eyebrow text={spec.eyebrow} />
      <Title text={spec.title} y={PAD + 76} size={30} maxLines={2} />
      {hasMood ? (
        <g aria-hidden="true">
          {bins.map((value, i) => (
            <path key={i} d={flowerPath(value, { size, cx: PAD + step * (i + 0.5), cy: rowY })} fill={moodHex(value)} />
          ))}
          <text x={PAD} y={rowY + 66} fontSize="34" fill={INK} className={styles.displayItalic}>
            {spec.verdict}
          </text>
        </g>
      ) : null}
      {shownLines.length ? (
        <>
          <Glass y={cardTop} height={cardH} />
          <text fontSize="13" fill={INK} className={styles.sans}>
            {shownLines.map((line, i) => (
              <tspan key={i} x={PAD + 20} y={cardTop + 30 + i * 18}>
                {line}
              </tspan>
            ))}
          </text>
        </>
      ) : null}
    </SlideFrame>
  );
}

// ───────── Year cover ─────────

function CoverSlide({ spec, ...rest }: { spec: Extract<SlideSpec, { type: 'cover' }> } & ObjectBaseProps) {
  const id = useSvgId('cover');
  const size = fitFontSize(spec.word, INNER, { ratio: GLYPH_RATIO.poster, min: 40, max: 120 });
  const { lines } = wrapLines(spec.title, INNER, 26, { ratio: 0.46, maxLines: 3 });
  return (
    <ObjectFrame viewBox={`0 0 ${W} ${H}`} label={spec.label} {...rest}>
      <defs>
        <radialGradient id={`${id}-g`} cx="50%" cy="0%" r="90%">
          <stop offset="0" stopColor="#5BE3B0" stopOpacity="0.55" />
          <stop offset="0.5" stopColor="#4B7FD8" stopOpacity="0.3" />
          <stop offset="1" stopColor="#4B4FD8" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-v`} cx="90%" cy="30%" r="60%">
          <stop offset="0" stopColor="#B46BE0" stopOpacity="0.4" />
          <stop offset="1" stopColor="#B46BE0" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-m`} cx="10%" cy="100%" r="70%">
          <stop offset="0" stopColor={moodHex(spec.glow)} stopOpacity="0.4" />
          <stop offset="1" stopColor={moodHex(spec.glow)} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width={W} height={H} rx="20" fill="#07080F" />
      <rect width={W} height={H} rx="20" fill={`url(#${id}-g)`} />
      <rect width={W} height={H} rx="20" fill={`url(#${id}-v)`} />
      <rect width={W} height={H} rx="20" fill={`url(#${id}-m)`} />
      <Eyebrow text={spec.eyebrow} />
      <text x={PAD} y={300} fontSize={size} fill={INK} textLength={INNER} lengthAdjust="spacingAndGlyphs" className={styles.poster}>
        {spec.word}
      </text>
      <text fontSize="26" fill={INK} className={styles.displayItalic}>
        {lines.map((line, i) => (
          <tspan key={i} x={PAD} y={352 + i * 32}>
            {line}
          </tspan>
        ))}
      </text>
      {spec.subtitle ? (
        <text x={PAD} y={CARD_BOTTOM} fontSize="10" fill={INK_2} className={styles.label}>
          {spec.subtitle.length > 44 ? `${spec.subtitle.slice(0, 43)}…` : spec.subtitle}
        </text>
      ) : null}
    </ObjectFrame>
  );
}

/** One slide of a story. Object cards (poster, passport, ticket) come from `ui/objects`. */
export function SlideView({ spec }: { spec: SlideSpec }) {
  switch (spec.type) {
    case 'poster':
      return <Poster month={spec.month} year={spec.year} phrase={spec.phrase} moods={spec.moods} stats={spec.stats} />;
    case 'passport':
      return <Passport year={spec.year} hero={spec.hero} stats={spec.stats} issuedOn={spec.issuedOn} />;
    case 'ticket':
      return <Ticket date={spec.date} from={spec.from} to={spec.to} hero={spec.hero} stats={spec.stats} />;
    case 'metrics':
      return <MetricsSlide spec={spec} />;
    case 'list':
      return <ListSlide spec={spec} />;
    case 'text':
      return <TextSlide spec={spec} />;
    case 'mood':
      return <MoodSlide spec={spec} />;
    case 'cover':
      return <CoverSlide spec={spec} />;
  }
}
