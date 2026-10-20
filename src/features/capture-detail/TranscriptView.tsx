import { forwardRef } from 'react';
import type { ID, ItemKind } from '../../domain/types';
import { TYPE_LABELS, TypeDot, cx } from '../../ui';
import type { LocatedQuote, TextSpan } from './transcript';
import { segmentTranscript } from './transcript';
import styles from './TranscriptView.module.css';

export interface QuoteInfo {
  kind: ItemKind;
  title: string;
}

export interface TranscriptViewProps {
  text: string;
  quotes: readonly LocatedQuote[];
  /** Kind and title of each object, for the dot and the screen reader text. */
  info: ReadonlyMap<ID, QuoteInfo>;
  /** The phrase being played (an estimate, never word by word). */
  current?: TextSpan | null;
  selectedId?: ID | null;
  flashId?: ID | null;
  onQuoteClick?(itemId: ID): void;
}

/**
 * The transcript as one serif text. Quotes of extracted objects are marked (a neutral underline and the
 * type dot; a click goes to the object), the phrase being played gets a soft background.
 */
export const TranscriptView = forwardRef<HTMLDivElement, TranscriptViewProps>(function TranscriptView(
  { text, quotes, info, current, selectedId, flashId, onQuoteClick },
  ref,
) {
  const segments = segmentTranscript(text, quotes, current);
  return (
    <div ref={ref} className={styles.text} lang="ru">
      {segments.map((segment) => {
        const dots = segment.quoteStartOf.map((id) => {
          const entry = info.get(id);
          return entry ? <TypeDot key={id} kind={entry.kind} size={6} className={styles.dot} /> : null;
        });
        if (segment.itemIds.length === 0) {
          return (
            <span key={segment.start} className={cx(segment.current && styles.current)} data-current={segment.current || undefined}>
              {segment.text}
            </span>
          );
        }
        const primary = segment.itemIds[0]!;
        const entry = info.get(primary);
        const label = entry ? `${segment.text} (${TYPE_LABELS[entry.kind]}: ${entry.title})` : segment.text;
        return (
          <span key={segment.start}>
            {dots}
            <span
              role="button"
              tabIndex={0}
              className={cx(
                styles.quote,
                segment.current && styles.current,
                segment.itemIds.includes(selectedId ?? '') && styles.selected,
                segment.itemIds.includes(flashId ?? '') && styles.flash,
              )}
              data-quote={primary}
              data-quote-ids={segment.itemIds.join(' ')}
              data-current={segment.current || undefined}
              aria-label={label}
              onClick={() => onQuoteClick?.(primary)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onQuoteClick?.(primary);
                }
              }}
            >
              {segment.text}
            </span>
          </span>
        );
      })}
    </div>
  );
});
