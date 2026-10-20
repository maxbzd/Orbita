import { nowISO } from '../../domain/dates';
import { newId } from '../../domain/ids';
import type { DayKey, ID, Review, ReviewAnswer, ReviewPeriod } from '../../domain/types';
import { NotFoundError, applyPatch, hardDelete, isLive, notDeleted, restoreRecord, softDeleteRecord } from '../internal';
import { db } from '../schema';

type Managed = 'updatedAt' | 'deletedAt';

/** Defaults: empty headline, sections and questions, `generatedBy` rules. */
export type NewReview = Pick<Review, 'period' | 'startDay' | 'endDay'> &
  Partial<Omit<Review, 'period' | 'startDay' | 'endDay' | Managed>>;

/**
 * There is one review per period (`[period+startDay]`). Saving again regenerates its content in place:
 * the id, creation time and the user's `answers` are kept, and a trashed review comes back.
 */
export async function upsert(input: NewReview): Promise<Review> {
  return db.transaction('rw', db.reviews, async () => {
    const existing = await find(input.period, input.startDay, { includeDeleted: true });
    const now = nowISO();
    if (existing) {
      const next = applyPatch(existing, {
        endDay: input.endDay,
        headline: input.headline ?? '',
        sections: input.sections ?? [],
        questions: input.questions ?? [],
        generatedBy: input.generatedBy ?? 'rules',
        deletedAt: undefined,
        updatedAt: now,
      });
      await db.reviews.put(next);
      return next;
    }
    const createdAt = input.createdAt ?? now;
    const review: Review = {
      ...input,
      id: input.id ?? newId(),
      createdAt,
      updatedAt: createdAt,
      headline: input.headline ?? '',
      sections: input.sections ?? [],
      questions: input.questions ?? [],
      generatedBy: input.generatedBy ?? 'rules',
    };
    await db.reviews.add(review);
    return review;
  });
}

export async function get(id: ID): Promise<Review | undefined> {
  return db.reviews.get(id);
}

export async function getMany(ids: readonly ID[]): Promise<Review[]> {
  return (await db.reviews.bulkGet([...ids])).filter(isLive);
}

export async function find(
  period: ReviewPeriod,
  startDay: DayKey,
  { includeDeleted = false }: { includeDeleted?: boolean } = {},
): Promise<Review | undefined> {
  const review = await db.reviews.where('[period+startDay]').equals([period, startDay]).first();
  return review && (includeDeleted || notDeleted(review)) ? review : undefined;
}

/** Reviews (optionally of one period), latest period first. */
export async function list({ period }: { period?: ReviewPeriod } = {}): Promise<Review[]> {
  const source = period ? db.reviews.where('[period+startDay]').between([period, ''], [period, '￿']) : db.reviews.toCollection();
  const reviews = await source.filter(notDeleted).toArray();
  return reviews.sort((a, b) => b.startDay.localeCompare(a.startDay));
}

/** Stores the user's answer to one of the review's questions (the same question is overwritten). */
export async function saveAnswer(id: ID, answer: ReviewAnswer): Promise<Review> {
  return db.transaction('rw', db.reviews, async () => {
    const review = await db.reviews.get(id);
    if (!review) throw new NotFoundError('reviews', id);
    const others = (review.answers ?? []).filter((existing) => existing.question !== answer.question);
    const next: Review = { ...review, answers: [...others, answer], updatedAt: nowISO() };
    await db.reviews.put(next);
    return next;
  });
}

export async function remove(id: ID): Promise<Review> {
  return softDeleteRecord('reviews', id);
}

export async function restore(id: ID): Promise<Review> {
  return restoreRecord('reviews', id);
}

export async function destroy(id: ID): Promise<void> {
  await hardDelete('reviews', id);
}
