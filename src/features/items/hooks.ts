import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { findById, linksRepo } from '../../db';
import type { EntityRef } from '../../db';
import { localDayKey } from '../../domain/dates';
import { truncate } from '../../domain/text';
import type { DayKey, ID, Item, ItemKind, LinkKind } from '../../domain/types';
import { t } from '../../i18n';

/** Today's local day, refreshed once a minute so "просрочено" flips at midnight. */
export function useToday(): DayKey {
  const [today, setToday] = useState<DayKey>(() => localDayKey());
  useEffect(() => {
    const timer = setInterval(() => setToday((current) => {
      const next = localDayKey();
      return next === current ? current : next;
    }), 60_000);
    return () => clearInterval(timer);
  }, []);
  return today;
}

export interface RelatedEntity {
  id: ID;
  /** How it relates to the object, in words: «Дубль», «Заменяет». */
  relation: string;
  title: string;
  table: EntityRef['table'];
  /** Set for objects (they open in the sheet). */
  kind?: ItemKind;
}

const OUTGOING: Record<LinkKind, string> = {
  get related() { return t('Related') },
  get caused() { return t('Led to') },
  get follows() { return t('Continues') },
  get supersedes() { return t('Replaces') },
  get duplicate() { return t('Duplicate') },
};
const INCOMING: Record<LinkKind, string> = {
  get related() { return t('Related') },
  get caused() { return t('Cause') },
  get follows() { return t('Continuation') },
  get supersedes() { return t('Replaced') },
  get duplicate() { return t('Duplicate of this') },
};

function titleOf(entity: EntityRef): string {
  switch (entity.table) {
    case 'captures':
      return entity.record.title?.trim() || truncate(entity.record.text.trim(), 60) || t('Record');
    case 'items':
      return entity.record.title;
    case 'people':
    case 'projects':
      return entity.record.name;
    case 'patterns':
      return entity.record.title;
    case 'reviews':
      return entity.record.headline || t('Review');
    case 'checkins':
      return t('State');
  }
}

/**
 * What the object is connected to: links in both directions, the duplicate the AI suspected,
 * related ideas and the fact that replaced it. Trashed and missing records are left out.
 */
export function useRelated(item: Item | null | undefined): RelatedEntity[] | undefined {
  const refs = item
    ? JSON.stringify([
        item.id,
        item.duplicateOf ?? null,
        item.kind === 'idea' ? item.relatedIds : [],
        item.kind === 'fact' ? (item.supersededBy ?? null) : null,
      ])
    : null;
  return useLiveQuery(async () => {
    if (!item) return [];
    const wanted = new Map<ID, string>();
    for (const link of await linksRepo.listFor(item.id)) {
      const outgoing = link.from === item.id;
      wanted.set(outgoing ? link.to : link.from, (outgoing ? OUTGOING : INCOMING)[link.kind]);
    }
    if (item.duplicateOf) wanted.set(item.duplicateOf, t('Possible duplicate', undefined, 'hooks'));
    if (item.kind === 'idea') for (const id of item.relatedIds) if (!wanted.has(id)) wanted.set(id, t('Related'));
    if (item.kind === 'fact' && item.supersededBy) wanted.set(item.supersededBy, t('Replaced by a newer one'));
    wanted.delete(item.id);
    const found = await Promise.all([...wanted.entries()].map(async ([id, relation]) => ({ relation, entity: await findById(id) })));
    return found.flatMap(({ relation, entity }): RelatedEntity[] => {
      if (!entity || entity.record.deletedAt) return [];
      return [{ id: entity.record.id, relation, title: titleOf(entity), table: entity.table, kind: entity.table === 'items' ? entity.record.kind : undefined }];
    });
  }, [refs]);
}

/** `id → name` for the people the lists mention. */
export function usePeopleNames(people: readonly { id: ID; name: string }[] | undefined): Map<ID, string> {
  return useMemo(() => new Map((people ?? []).map((person) => [person.id, person.name])), [people]);
}
