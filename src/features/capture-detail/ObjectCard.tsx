import type { Item } from '../../domain/types';
import { TYPE_LABELS, TypeMedallion, Pill, Button, cx } from '../../ui';
import { ITEM_STATUS_LABELS, itemActions, itemMeta } from './itemModel';
import type { ItemAction } from './itemModel';
import styles from './ObjectCard.module.css';
import { t } from '../../i18n';

export interface ObjectCardProps {
  item: Item;
  /** The quote is in the text: "Откуда это" can go there. */
  quoteFound: boolean;
  /** Second of the recording the quote is near (shown on the button), if there is audio. */
  quoteTime?: string;
  selected?: boolean;
  flash?: boolean;
  busy?: boolean;
  onAction(action: ItemAction): void;
  onShowSource(): void;
}

const STATUS_TONE = { proposed: 'ai', active: 'neutral', done: 'ok', dropped: 'neutral', dismissed: 'neutral' } as const;

/** An object extracted from the record: type, wording, the quote it stands on, status and quick actions. */
export function ObjectCard({ item, quoteFound, quoteTime, selected, flash, busy, onAction, onShowSource }: ObjectCardProps) {
  const meta = itemMeta(item);
  const muted = item.status === 'dismissed' || item.status === 'dropped';
  return (
    <li
      className={cx(styles.card, selected && styles.selected, flash && styles.flash, muted && styles.muted)}
      data-item={item.id}
      data-status={item.status}
      aria-label={`${TYPE_LABELS[item.kind]}: ${item.title}`}
    >
      <TypeMedallion kind={item.kind} size={36} className={styles.medallion} />
      <div className={styles.body}>
        <div className={styles.top}>
          <span className={styles.kind}>{TYPE_LABELS[item.kind]}</span>
          {item.status !== 'active' ? (
            <Pill tone={STATUS_TONE[item.status]} dot={item.status === 'proposed'}>
              {ITEM_STATUS_LABELS[item.status]}
            </Pill>
          ) : null}
        </div>
        <p className={styles.title}>{item.title}</p>
        {meta ? <p className={styles.meta}>{meta}</p> : null}
        {item.quote ? (
          <blockquote className={styles.quote}>
            «{item.quote}»
          </blockquote>
        ) : null}
        <div className={styles.actions}>
          {itemActions(item.status).map((spec) => (
            <Button
              key={spec.action}
              variant={spec.primary ? 'primary' : 'ghost'}
              size="sm"
              disabled={busy}
              onClick={() => onAction(spec.action)}
              aria-label={`${spec.label}: ${item.title}`}
            >
              {spec.label}
            </Button>
          ))}
          {item.quote ? (
            quoteFound ? (
              <Button variant="ghost" size="sm" iconStart="link" onClick={onShowSource}>
                
                {t('Where this comes from{v}', { v: quoteTime ? ` · ${quoteTime}` : '' })}
              </Button>
            ) : (
              <span className={styles.lost}>{t('The quote is not in the text: it was edited.')}</span>
            )
          ) : null}
        </div>
      </div>
    </li>
  );
}
