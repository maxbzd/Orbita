import { itemsRepo, linksRepo } from '../../db';
import { nowISO } from '../../domain/dates';
import { findSimilar } from '../../domain/similarity';
import type { SimilarMatch } from '../../domain/similarity';
import type { ID, IdeaStage, Item, ItemOfKind } from '../../domain/types';
import { stageChange } from './model';
import { t } from '../../i18n';

/** Operations that touch more than one object. Everything goes through the repositories. */

const union = <T>(a: readonly T[], b: readonly T[]): T[] => [...new Set([...a, ...b])];

/** Moves an idea to a stage; "dropped" closes it, any other stage opens it again. */
export async function setIdeaStage(idea: ItemOfKind<'idea'>, stage: IdeaStage): Promise<Item> {
  return itemsRepo.update(idea.id, stageChange(stage, idea.status));
}

/** Ideas that read like `idea` (trigram similarity), most similar first; dropped ones and itself are left out. */
export function findDuplicateCandidates(idea: ItemOfKind<'idea'>, ideas: readonly Item[], threshold = 0.4): SimilarMatch<ItemOfKind<'idea'>>[] {
  const others = ideas.filter(
    (other): other is ItemOfKind<'idea'> => other.kind === 'idea' && other.id !== idea.id && other.status !== 'dropped' && other.status !== 'dismissed' && other.status !== 'proposed',
  );
  const text = (item: Item): string => `${item.title} ${item.body ?? ''}`;
  return findSimilar(text(idea), others, text, threshold);
}

/**
 * Merges the idea `sourceId` into `targetId`: the source becomes a dropped duplicate that points at the target,
 * the target takes over its people, projects and tags. Returns a function that undoes the merge.
 */
export async function mergeIdea(sourceId: ID, targetId: ID): Promise<() => Promise<void>> {
  const [source, target] = await Promise.all([itemsRepo.get(sourceId), itemsRepo.get(targetId)]);
  if (!source || !target || source.kind !== 'idea' || target.kind !== 'idea' || source.id === target.id) {
    throw new RangeError(t('Only two different ideas can be merged'));
  }
  const hadLink = (await linksRepo.listFrom(source.id)).some((link) => link.to === target.id && link.kind === 'duplicate');

  await itemsRepo.update(target.id, {
    personIds: union(target.personIds, source.personIds),
    projectIds: union(target.projectIds, source.projectIds),
    tags: union(target.tags, source.tags),
    relatedIds: union(target.relatedIds, source.relatedIds).filter((id) => id !== source.id && id !== target.id),
  });
  await itemsRepo.update(source.id, { status: 'dropped', stage: 'dropped', duplicateOf: target.id });
  const link = await linksRepo.create({ from: source.id, to: target.id, kind: 'duplicate' });

  return async () => {
    await itemsRepo.update(source.id, { status: source.status, stage: source.stage, duplicateOf: source.duplicateOf });
    await itemsRepo.update(target.id, {
      personIds: target.personIds,
      projectIds: target.projectIds,
      tags: target.tags,
      relatedIds: target.relatedIds,
    });
    if (!hadLink) await linksRepo.remove(link.id);
  };
}

/** "Это не дубль": forgets the AI's guess. */
export async function clearDuplicate(id: ID): Promise<Item> {
  return itemsRepo.update(id, { duplicateOf: undefined });
}

/** Turns an idea into a task that keeps the quote and the source; the idea moves to "В работе". */
export async function ideaToTask(idea: ItemOfKind<'idea'>): Promise<ItemOfKind<'task'>> {
  const task = (await itemsRepo.create({
    kind: 'task',
    title: idea.title,
    body: idea.body,
    captureId: idea.captureId,
    quote: idea.quote,
    quoteStart: idea.quoteStart,
    personIds: idea.personIds,
    projectIds: idea.projectIds,
    tags: idea.tags,
  })) as ItemOfKind<'task'>;
  await linksRepo.create({ from: task.id, to: idea.id, kind: 'follows' });
  if (idea.stage === 'spark' || idea.stage === 'exploring') await setIdeaStage(idea, 'doing');
  return task;
}

/** A fact changed: a new fact with the new value takes over, the old one is kept as outdated. */
export async function supersedeFact(old: ItemOfKind<'fact'>, value: string): Promise<ItemOfKind<'fact'>> {
  const next = (await itemsRepo.create({
    kind: 'fact',
    title: old.title,
    value: value.trim(),
    validFrom: nowISO(),
    personIds: old.personIds,
    projectIds: old.projectIds,
    tags: old.tags,
  })) as ItemOfKind<'fact'>;
  await itemsRepo.update(old.id, { supersededBy: next.id, status: 'dropped' });
  await linksRepo.create({ from: next.id, to: old.id, kind: 'supersedes' });
  return next;
}
