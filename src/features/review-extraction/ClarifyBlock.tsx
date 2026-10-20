import { useState } from 'react';
import { usePeople } from '../../db/hooks';
import type { ID } from '../../domain/types';
import { Button, Caption, Chip, Field, Heading } from '../../ui/primitives';
import { answerClarification, clarifyChoices } from './actions';
import styles from './Review.module.css';
import { t } from '../../i18n';

export interface ClarifyBlockProps {
  captureId: ID;
  question: string;
  /** Answered or skipped: the parent moves on. */
  onDone(): void;
  /** `card` is the full card of the stack, `inline` sits in the sheet. */
  variant?: 'card' | 'inline';
}

/**
 * The model is not sure and asks (§3.5 point 3): «Кому ты это обещал?» with chips and «Другое», «Пропустить». One question
 * at a time. The answer is kept with the record and, when it names a person, links them.
 */
export function ClarifyBlock({ captureId, question, onDone, variant = 'inline' }: ClarifyBlockProps) {
  const people = usePeople() ?? [];
  const [other, setOther] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const choices = clarifyChoices(question, people);

  const answer = async (label: string, personId?: ID): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await answerClarification(captureId, question, label, { personId });
    } finally {
      setBusy(false);
      onDone();
    }
  };

  return (
    <div className={variant === 'card' ? styles.clarifyCard : styles.clarify} role="group" aria-label={t('Question from the AI')} data-testid="clarify">
      <Caption>{t('The AI is not sure')}</Caption>
      <Heading variant="headline">{question}</Heading>
      <div className={styles.chips}>
        {choices.options.map((option) => (
          <Chip key={option.label} size="lg" disabled={busy} onClick={() => void answer(option.label, option.personId)}>
            {option.label}
          </Chip>
        ))}
        <Chip size="lg" selected={other} onClick={() => setOther((value) => !value)}>
          {t('Other')}
        </Chip>
      </div>
      {other ? (
        <form
          className={styles.clarifyOther}
          onSubmit={(event) => {
            event.preventDefault();
            if (text.trim() !== '') void answer(text.trim());
          }}
        >
          <Field aria-label={t('Your own answer')} placeholder={t('Your own answer')} value={text} autoFocus onChange={(event) => setText(event.target.value)} />
          <Button variant="secondary" type="submit" disabled={text.trim() === ''}>
            {t('Answer', undefined, 'clarify-block')}
          </Button>
        </form>
      ) : null}
      <Button variant="ghost" size="sm" onClick={onDone}>
        {t('Skip')}
      </Button>
    </div>
  );
}
