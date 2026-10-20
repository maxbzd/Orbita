import { useState } from 'react';
import { Button, Caption, Heading, TextArea, Thought, useToast } from '../../ui';
import type { Review } from '../../domain/types';
import { saveReviewAnswer } from './actions';
import styles from './Reviews.module.css';
import { t } from '../../i18n';

export interface QuestionsBlockProps {
  review: Review;
  /** Typing pauses the story, so slides do not run away from under the hands. */
  onTypingChange?: (typing: boolean) => void;
}

function Question({ review, question, index, onTypingChange }: { review: Review; question: string; index: number; onTypingChange?: (typing: boolean) => void }) {
  const toast = useToast();
  const saved = review.answers?.find((entry) => entry.question === question)?.answer ?? '';
  const [draft, setDraft] = useState(saved);
  const [busy, setBusy] = useState(false);
  const clean = draft.trim();
  const unchanged = clean === saved.trim();

  const save = async (): Promise<void> => {
    if (clean === '' || busy) return;
    setBusy(true);
    try {
      await saveReviewAnswer(review, question, clean);
      toast.show({ message: t('Answer saved and kept in the Stream.') });
    } catch {
      toast.show({ message: t('Could not save the answer. The text stayed in the field.'), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className={styles.question}>
      <Thought as="p" size="sm" id={`review-q-${index}-text`}>
        {question}
      </Thought>
      <TextArea
        id={`review-q-${index}`}
        aria-labelledby={`review-q-${index}-text`}
        placeholder={t('Your own answer, a couple of sentences')}
        rows={3}
        autoGrow
        maxRows={8}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={() => onTypingChange?.(true)}
        onBlur={() => onTypingChange?.(false)}
        maxLength={4000}
      />
      <div className={styles.questionActions}>
        <Button size="sm" variant={unchanged || clean === '' ? 'secondary' : 'primary'} disabled={clean === '' || unchanged} loading={busy} onClick={() => void save()}>
          {saved ? t('Update the answer') : t('Save the answer')}
        </Button>
        {saved && unchanged ? <Caption tone="faint">{t('Saved')}</Caption> : null}
      </div>
    </li>
  );
}

/** Reflection questions with an answer field each. Answers go to `Review.answers` and into the stream as `review_answer`. */
export function QuestionsBlock({ review, onTypingChange }: QuestionsBlockProps) {
  if (review.questions.length === 0) return null;
  return (
    <section className={styles.questions} aria-labelledby="review-questions" id="review-questions-block">
      <Heading as="h2" variant="headline" id="review-questions">
        {t('Questions for yourself')}
      </Heading>
      <Caption tone="faint">{t('Answering is optional. Answers stay on this device and go into the Stream.')}</Caption>
      <ol className={styles.questionList}>
        {review.questions.map((question, index) => (
          <Question key={question} review={review} question={question} index={index} onTypingChange={onTypingChange} />
        ))}
      </ol>
    </section>
  );
}
