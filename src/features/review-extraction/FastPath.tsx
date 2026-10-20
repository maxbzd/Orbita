import { useMemo } from 'react';
import type { Capture, ID, Item, Person } from '../../domain/types';
import type { Job } from '../../state';
import { Body, Button, Caption, Display, IconButton, Label, Sheet, Toggle, TypeMedallion, TYPE_LABELS_PLURAL } from '../../ui/primitives';
import { ClarifyBlock } from './ClarifyBlock';
import { EntitiesPanel } from './EntitiesPanel';
import { isDuplicate } from './actions';
import { foundTitle, groupByKind, itemFacts } from './model';
import styles from './Review.module.css';
import { t } from '../../i18n';

export interface FastPathProps {
  open: boolean;
  onClose(): void;
  capture: Capture;
  proposed: readonly Item[];
  people: ReadonlyMap<ID, Person>;
  result: Job['result'];
  question: string | undefined;
  onQuestionDone(): void;
  autoAccept: boolean;
  autoAcceptPercent: number;
  onAutoAccept(enabled: boolean): void;
  onAcceptAll(): void;
  onOneByOne(startId?: ID): void;
  onAccept(item: Item): void;
  onDismiss(item: Item): void;
}

/**
 * «Нашёл N объектов» (§3.5, the quick path): rows by type with ✓ and ✕, one cream button «Принять всё», a quiet «По одному»
 * and the switch «Всегда принимать, если уверенность ≥ 80 %». Ten seconds on a walk.
 */
export function FastPath({
  open,
  onClose,
  capture,
  proposed,
  people,
  result,
  question,
  onQuestionDone,
  autoAccept,
  autoAcceptPercent,
  onAutoAccept,
  onAcceptAll,
  onOneByOne,
  onAccept,
  onDismiss,
}: FastPathProps) {
  const groups = useMemo(() => groupByKind(proposed), [proposed]);
  const clear = proposed.filter((item) => !isDuplicate(item)).length;
  const duplicates = proposed.length - clear;
  const title = foundTitle(proposed.length);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      hideTitle
      placement="auto"
      snaps={[0.5, 0.78, 0.94]}
      defaultSnapIndex={1}
      footer={
        <div className={styles.footer}>
          <Button variant="primary" fullWidth iconStart="check" disabled={clear === 0} onClick={onAcceptAll}>
            {clear > 0 ? t('Accept all ({clear})', { clear }) : t('Nothing to accept right away')}
          </Button>
          <Button variant="secondary" fullWidth onClick={() => onOneByOne()}>
            {t('One by one')}
          </Button>
        </div>
      }
    >
      <div className={styles.sheetBody} data-testid="fast-path">
        <Display as="p" size="l" aria-hidden="true" className={styles.found}>
          {title}
        </Display>
        {capture.title ? <Caption className={styles.fromCapture}>{t('from the record “{title}”', { title: capture.title })}</Caption> : null}

        {question ? <ClarifyBlock captureId={capture.id} question={question} onDone={onQuestionDone} /> : null}

        {groups.map((group) => (
          <section key={group.kind} className={styles.group} aria-label={TYPE_LABELS_PLURAL[group.kind]}>
            <Label>
              {TYPE_LABELS_PLURAL[group.kind]} · {group.items.length}
            </Label>
            <ul className={styles.rows}>
              {group.items.map((item) => {
                const facts = itemFacts(item, people);
                const duplicate = isDuplicate(item);
                return (
                  <li key={item.id} className={styles.row} data-duplicate={duplicate ? '' : undefined}>
                    <button type="button" className={styles.rowMain} onClick={() => onOneByOne(item.id)}>
                      <TypeMedallion kind={item.kind} size={36} />
                      <span className={styles.rowText}>
                        <span className={styles.rowTitle}>{item.title}</span>
                        {facts.length > 0 || duplicate ? (
                          <span className={styles.rowFacts}>
                            {facts.join(' · ')}
                            {duplicate ? <span className={styles.dup}>{t('{v}Looks like something already saved', { v: facts.length > 0 ? ' · ' : '' })}</span> : null}
                          </span>
                        ) : null}
                      </span>
                    </button>
                    <span className={styles.rowActions}>
                      <IconButton icon="close" label={t('Dismiss: {title}', { title: item.title })} variant="ghost" onClick={() => onDismiss(item)} />
                      <IconButton icon="check" label={`${duplicate ? t('Save anyway') : t('Accept')}: ${item.title}`} variant="glass" onClick={() => onAccept(item)} />
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        {duplicates > 0 ? (
          <Body tone="muted" className={styles.dupNote}>
            {t('{v}. “Accept all” does not touch them: decide on each.', { v: duplicates === 1 ? t('One object looks like one already saved') : t('Objects that look like ones already saved: {duplicates}', { duplicates }) })}
          
          </Body>
        ) : null}

        <EntitiesPanel capture={capture} result={result} />

        <Toggle
          checked={autoAccept}
          onChange={onAutoAccept}
          label={t('Always accept if confidence ≥ {autoAcceptPercent} %', { autoAcceptPercent })}
          description={t('Doubtful items and ones similar to already saved still come to review.')}
        />
        <Caption className={styles.fine}>{t('AI can be wrong. Check it.')}</Caption>
      </div>
    </Sheet>
  );
}
