import { nowISO } from '../../domain/dates';
import { newId } from '../../domain/ids';
import type { ID, Link, LinkKind } from '../../domain/types';
import { db } from '../schema';
import { t } from '../../i18n';

export interface NewLink {
  from: ID;
  to: ID;
  kind: LinkKind;
}

/** Creates a link; the same (from, to, kind) is stored once, so repeating the call returns the existing link. */
export async function create({ from, to, kind }: NewLink): Promise<Link> {
  if (from === to) throw new RangeError(t('An object cannot be linked to itself'));
  return db.transaction('rw', db.links, async () => {
    const existing = await db.links
      .where('from')
      .equals(from)
      .filter((link) => link.to === to && link.kind === kind)
      .first();
    if (existing) return existing;
    const link: Link = { id: newId(), from, to, kind, createdAt: nowISO() };
    await db.links.add(link);
    return link;
  });
}

export async function listFrom(id: ID): Promise<Link[]> {
  return db.links.where('from').equals(id).toArray();
}

export async function listTo(id: ID): Promise<Link[]> {
  return db.links.where('to').equals(id).toArray();
}

/** Links in either direction. */
export async function listFor(id: ID): Promise<Link[]> {
  const [outgoing, incoming] = await Promise.all([listFrom(id), listTo(id)]);
  return [...outgoing, ...incoming];
}

export async function remove(id: ID): Promise<void> {
  await db.links.delete(id);
}

/** Drops every link that touches `id` (call when the entity is deleted for good). */
export async function removeFor(id: ID): Promise<void> {
  await db.links.where('from').equals(id).delete();
  await db.links.where('to').equals(id).delete();
}
