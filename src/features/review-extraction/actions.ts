import { msg, t } from '../../i18n';
import { capturesRepo, itemsRepo, peopleRepo, projectsRepo, settingsRepo } from '../../db';
import type { Capture, ID, Item, Person } from '../../domain/types';

/**
 * What the buttons of the review do. Every change goes through the repositories, so the invariants of
 * docs/DATA_MODEL.md hold without this file knowing them: `proposed → active | dismissed` (1), the capture settles
 * to `done` when nothing is left to decide, `Person.mentionCount` is recomputed when a capture's people change (4).
 */

export const AUTO_ACCEPT_THRESHOLD = 0.8;

export const isDuplicate = (item: Item): boolean => item.duplicateOf !== undefined;

export function acceptItem(id: ID, edits: itemsRepo.ItemPatch = {}): Promise<Item> {
  return itemsRepo.accept(id, edits);
}

export function dismissItem(id: ID): Promise<Item> {
  return itemsRepo.dismiss(id);
}

/**
 * «Принять всё»: everything that is not a suspected duplicate. A duplicate is the user's call, one at a time, so it
 * stays proposed (and the capture stays in review until it is decided).
 */
export async function acceptAllClear(captureId: ID): Promise<Item[]> {
  const proposed = await itemsRepo.listProposed(captureId);
  const accepted: Item[] = [];
  for (const item of proposed) {
    if (!isDuplicate(item)) accepted.push(await itemsRepo.accept(item.id));
  }
  return accepted;
}

/**
 * «Отменить» after a decision (5 seconds): the object waits for review again, and a capture that had just settled to
 * `done` goes back to `review`.
 */
export async function undoDecision(id: ID): Promise<void> {
  const item = await itemsRepo.get(id);
  if (!item) return;
  await itemsRepo.setStatus(id, 'proposed');
  if (!item.captureId) return;
  const capture = await capturesRepo.get(item.captureId);
  if (capture?.status === 'done') await capturesRepo.update(capture.id, { status: 'review' });
}

/** «Всегда принимать, если уверенность ≥ 80 %». */
export async function setAutoAccept(enabled: boolean): Promise<void> {
  await settingsRepo.updateSettings({ autoAccept: { enabled, ...(enabled && { minConfidence: AUTO_ACCEPT_THRESHOLD }) } });
}

// ───────── People and projects ─────────

const without = (ids: readonly ID[], id: ID): ID[] => ids.filter((other) => other !== id);

/**
 * «Это не человек»: the mention is taken back from the capture and its objects. A person who has no other mention
 * (the one the run just created) goes to the trash with it.
 */
export async function rejectPerson(personId: ID, captureId: ID): Promise<void> {
  const capture = await capturesRepo.get(captureId);
  if (capture) await capturesRepo.update(captureId, { personIds: without(capture.personIds, personId) });
  for (const item of await itemsRepo.listByCapture(captureId)) {
    if (!item.personIds.includes(personId) && !(item.kind === 'commitment' && item.counterpartyId === personId)) continue;
    const person = await peopleRepo.get(personId);
    await itemsRepo.update(item.id, {
      personIds: without(item.personIds, personId),
      ...(item.kind === 'commitment' && item.counterpartyId === personId && { counterpartyId: undefined, counterpartyName: item.counterpartyName ?? person?.name }),
    });
  }
  const person = await peopleRepo.get(personId);
  if (person && person.mentionCount === 0) await peopleRepo.remove(personId);
}

/** «Это уже есть»: the person the run created is the same as an existing one. */
export async function mergePerson(createdId: ID, existingId: ID): Promise<Person> {
  return peopleRepo.merge(createdId, existingId);
}

/** Picks one of several people a name could mean. */
export async function linkPerson(captureId: ID, personId: ID): Promise<void> {
  const capture = await capturesRepo.get(captureId);
  if (!capture || capture.personIds.includes(personId)) return;
  await capturesRepo.update(captureId, { personIds: [...capture.personIds, personId] });
}

/** «Другой»: the name is somebody new. */
export async function createAndLinkPerson(captureId: ID, name: string): Promise<Person> {
  const person = await peopleRepo.create({ name });
  await linkPerson(captureId, person.id);
  return (await peopleRepo.get(person.id)) ?? person;
}

export async function rejectProject(projectId: ID, captureId: ID): Promise<void> {
  const capture = await capturesRepo.get(captureId);
  if (capture) await capturesRepo.update(captureId, { projectIds: without(capture.projectIds, projectId) });
  for (const item of await itemsRepo.listByCapture(captureId)) {
    if (item.projectIds.includes(projectId)) await itemsRepo.update(item.id, { projectIds: without(item.projectIds, projectId) });
  }
  if ((await capturesRepo.list({ projectId })).length === 0) await projectsRepo.remove(projectId);
}

/** The project the run created is an existing one under another name. */
export async function mergeProject(createdId: ID, existingId: ID, captureId: ID): Promise<void> {
  const replace = (ids: readonly ID[]): ID[] => [...new Set(ids.map((id) => (id === createdId ? existingId : id)))];
  const capture = await capturesRepo.get(captureId);
  if (capture) await capturesRepo.update(captureId, { projectIds: replace(capture.projectIds) });
  for (const item of await itemsRepo.listByCapture(captureId)) {
    if (item.projectIds.includes(createdId)) await itemsRepo.update(item.id, { projectIds: replace(item.projectIds) });
  }
  if ((await capturesRepo.list({ projectId: createdId })).length === 0) await projectsRepo.destroy(createdId);
}

// ───────── Clarifying question ─────────

export type ClarifyKind = 'people' | 'when' | 'yesno';

export interface ClarifyOption {
  label: string;
  /** The person this answer points at, when it is one. */
  personId?: ID;
}

export interface ClarifyChoices {
  kind: ClarifyKind;
  options: ClarifyOption[];
}

// The model's question comes in the user's language (or the other one), so both are recognised.
const ASKS_WHO = /(?:^|[^\p{L}])(?:кому|кто|кого|кем|с кем|у кого|от кого|про кого|who|whom|whose|to whom|with whom|from whom|about whom)(?![\p{L}])/iu;
const ASKS_WHEN = /(?:^|[^\p{L}])(?:когда|срок|до какого|к какому|во сколько|к какой дате|when|deadline|by when|what date|what time|how soon)(?![\p{L}])/iu;

const FALLBACK_RECIPIENTS = [msg('A colleague'), msg('A friend'), msg('A partner')] as const;

/**
 * The chips under the model's question (§3.5 point 3): “Who did you promise this to?” offers the people the user talks about
 * most, then generic ones; “When?” offers days. “Other” and “Skip” are always there and are not options.
 */
export function clarifyChoices(question: string, people: readonly Person[]): ClarifyChoices {
  if (ASKS_WHO.test(question)) {
    const known: ClarifyOption[] = people.slice(0, 3).map((person) => ({ label: person.name, personId: person.id }));
    const generic = FALLBACK_RECIPIENTS.slice(0, Math.max(0, 3 - known.length)).map((label) => ({ label: t(label) }));
    return { kind: 'people', options: [...known, ...generic] };
  }
  if (ASKS_WHEN.test(question)) {
    return { kind: 'when', options: [t('Today'), t('Tomorrow'), t('This week')].map((label) => ({ label })) };
  }
  return { kind: 'yesno', options: [{ label: t('Yes') }, { label: t('No') }] };
}

/**
 * The answer is kept with the record: a line is added under the text (it is what the next run reads), and when it
 * points at a person, the person is linked to the capture and to the commitments that had no counterparty.
 */
export async function answerClarification(
  captureId: ID,
  question: string,
  answer: string,
  { personId }: { personId?: ID } = {},
): Promise<Capture> {
  const capture = await capturesRepo.get(captureId);
  if (!capture) throw new RangeError(t('Record not found'));
  const note = t('[Clarification] {v} — {v2}', { v: question.trim(), v2: answer.trim() });
  const updated = await capturesRepo.update(captureId, { text: `${capture.text.trimEnd()}\n\n${note}` });
  if (personId) {
    await linkPerson(captureId, personId);
    for (const item of await itemsRepo.listProposed(captureId)) {
      if (item.kind === 'commitment' && item.counterpartyId === undefined) {
        await itemsRepo.update(item.id, { counterpartyId: personId, personIds: [...new Set([...item.personIds, personId])] });
      }
    }
  }
  return updated;
}
