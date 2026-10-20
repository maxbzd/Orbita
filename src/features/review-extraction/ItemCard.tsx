import type { Capture, ID, Item, Person } from '../../domain/types';
import { useItem } from '../../db/hooks';
import { Body, Caption, Chip, Heading, Label, TYPE_LABELS, TypeMedallion } from '../../ui/primitives';
import { SourceQuote } from './SourceQuote';
import { isDuplicate } from './actions';
import { itemFacts } from './model';
import styles from './Review.module.css';
import { t } from '../../i18n';

/** Short lists under the title of a decision. */
function Bullets({ title, lines }: { title: string; lines: readonly string[] }) {
  if (lines.length === 0) return null;
  return (
    <div className={styles.bullets}>
      <Label>{title}</Label>
      <ul>
        {lines.slice(0, 3).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

function Details({ item }: { item: Item }) {
  switch (item.kind) {
    case 'decision':
      return (
        <>
          <Bullets title={t('Alternatives')} lines={item.alternatives} />
          <Bullets title={t('Reasons')} lines={item.reasons} />
          {item.expected ? <Body tone="muted">{t('Expected: {expected}', { expected: item.expected })}</Body> : null}
        </>
      );
    case 'prediction':
      return (
        <div className={styles.probability} role="img" aria-label={t('Probability {round} %', { round: Math.round(item.probability * 100) })}>
          <span style={{ width: `${Math.round(item.probability * 100)}%` }} />
        </div>
      );
    default:
      return null;
  }
}

export interface ItemCardProps {
  item: Item;
  capture: Capture;
  people: ReadonlyMap<ID, Person>;
}

/** The face of a card: type, wording, whom and when, the details of its kind, the duplicate mark and «Откуда это». */
export function ItemCard({ item, capture, people }: ItemCardProps) {
  const facts = itemFacts(item, people);
  const twin = useItem(item.duplicateOf);
  const percent = item.confidence !== undefined ? Math.round(item.confidence * 100) : undefined;

  return (
    <div className={styles.cardInner}>
      <header className={styles.cardHead}>
        <TypeMedallion kind={item.kind} size={40} />
        <span className={styles.cardKind}>
          <Label tone="strong">{TYPE_LABELS[item.kind]}</Label>
          {percent !== undefined ? <Caption>{t('confidence {percent} %', { percent })}</Caption> : null}
        </span>
      </header>

      <Heading variant="title" as="h3" className={styles.cardTitle}>
        {item.title}
      </Heading>
      {facts.length > 0 ? (
        <div className={styles.facts}>
          {facts.map((fact) => (
            <Chip key={fact}>{fact}</Chip>
          ))}
        </div>
      ) : null}
      {item.body ? <Body tone="muted" className={styles.cardBody}>{item.body}</Body> : null}
      <Details item={item} />

      {isDuplicate(item) ? (
        <p className={styles.dupBanner} role="note">
          
          {t('Looks like something already saved{v}.', { v: twin ? `: «${twin.title}»` : '' })}
        
        </p>
      ) : null}

      <SourceQuote item={item} capture={capture} />
    </div>
  );
}
