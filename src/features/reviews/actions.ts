import { checkAiReadiness, createLlmProvider, generateReview } from '../../ai';
import type { ReviewResult } from '../../ai';
import { capturesRepo, getSettings, reviewsRepo } from '../../db';
import { localDayKey, nowISO } from '../../domain/dates';
import { truncate } from '../../domain/text';
import type { DayKey, Review, ReviewPeriod } from '../../domain/types';
import { t } from '../../i18n';

/** What the reviews screens do. Everything goes through the repositories and `src/ai`; no screen touches Dexie. */

/** Whether a review made now gets the model's voice (a ready provider; the clipboard mode is not used for reviews). */
export async function aiReadyForReviews(): Promise<boolean> {
  const settings = await getSettings();
  return settings.ai.provider !== 'manual' && checkAiReadiness(settings).ready;
}

/** Builds (or rebuilds in place) the review of the period around `anchorDay`: by rules, and with the model when it is ready. */
export async function makeReview(period: ReviewPeriod, anchorDay: DayKey, signal?: AbortSignal): Promise<ReviewResult> {
  const settings = await getSettings();
  const ready = settings.ai.provider !== 'manual' && checkAiReadiness(settings).ready;
  return generateReview(period, anchorDay, { llm: ready ? createLlmProvider(settings) : undefined, signal });
}

/**
 * Stores the answer to one question twice: in the review (`answers`) and as a `review_answer` capture, which the stream and
 * search see like any other record. Answering the same question again edits both.
 */
export async function saveReviewAnswer(review: Review, question: string, answer: string, today: DayKey = localDayKey()): Promise<Review> {
  const text = answer.trim();
  if (text === '') throw new Error('Empty answer');
  const previous = review.answers?.find((entry) => entry.question === question);
  const existing = previous?.captureId ? await capturesRepo.get(previous.captureId) : undefined;
  let captureId: string;
  if (existing && !existing.deletedAt) {
    await capturesRepo.update(existing.id, { text });
    captureId = existing.id;
  } else {
    const capture = await capturesRepo.create({
      kind: 'review_answer',
      text,
      title: t('Answer: {truncate}', { truncate: truncate(question, 60) }),
      summary: question,
      day: today,
      tags: [t('review')],
      status: 'done',
      processedAt: nowISO(),
    });
    captureId = capture.id;
  }
  return reviewsRepo.saveAnswer(review.id, { question, answer: text, captureId });
}
