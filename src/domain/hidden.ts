/**
 * "Скрыть от ИИ" on a check-in: the state is kept for the user, but no review, pattern search or question
 * to a model may read it. There is no dedicated field in the data model, so the marker is a tag.
 */
export const HIDE_FROM_AI_TAG = 'hidden-from-ai';
/** The tag older versions wrote; still honoured. */
const LEGACY_HIDE_TAG = 'скрыто от ии';

/** True when the check-in must stay out of every prompt. */
export function isHiddenFromAi(checkIn: { tags: readonly string[] }): boolean {
  return checkIn.tags.includes(HIDE_FROM_AI_TAG) || checkIn.tags.includes(LEGACY_HIDE_TAG);
}
