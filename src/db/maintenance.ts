import type { ID } from '../domain/types';
import { allTables } from './internal';
import * as captures from './repos/captures';
import * as checkins from './repos/checkins';
import * as items from './repos/items';
import * as patterns from './repos/patterns';
import * as people from './repos/people';
import * as projects from './repos/projects';
import * as reviews from './repos/reviews';
import { db } from './schema';
import { purgeTrash } from './trash';
import { t } from '../i18n';

const isDemo = (record: { isDemo?: boolean }): boolean => record.isDemo === true;

export async function hasDemoData(): Promise<boolean> {
  const tables = [db.captures, db.items, db.people, db.projects, db.checkins, db.patterns, db.reviews];
  const counts = await Promise.all(tables.map((table) => table.filter(isDemo).count()));
  return counts.some((count) => count > 0);
}

/**
 * Invariant 6: removes every demo record (`isDemo: true`) in one transaction and returns how many.
 * Real records that pointed at demo people or projects lose those references; accepted real items
 * whose source capture was demo keep living with `sourceDeleted`, like after any capture purge.
 * Demo records are deleted outright, leaving no tombstones: they never belonged to the user's history.
 */
export async function deleteDemoData(): Promise<number> {
  return db.transaction('rw', allTables(), async () => {
    const demoIds: ID[] = [];
    const groups = [
      { rows: db.items.filter(isDemo), destroy: items.destroy },
      { rows: db.captures.filter(isDemo), destroy: captures.destroy },
      { rows: db.people.filter(isDemo), destroy: people.destroy },
      { rows: db.projects.filter(isDemo), destroy: projects.destroy },
      { rows: db.checkins.filter(isDemo), destroy: checkins.destroy },
      { rows: db.patterns.filter(isDemo), destroy: patterns.destroy },
      { rows: db.reviews.filter(isDemo), destroy: reviews.destroy },
    ];
    for (const { rows, destroy } of groups) {
      for (const id of await rows.primaryKeys()) {
        await destroy(id);
        demoIds.push(id);
      }
    }
    await db.tombstones.bulkDelete(demoIds);
    return demoIds.length;
  });
}

/** Deletes everything the app stores — records, audio, settings, profile — and leaves empty tables. */
export async function wipeAll(): Promise<void> {
  await db.transaction('rw', allTables(), async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
  });
}

/** Housekeeping for app start: empties the part of the trash older than 30 days. Never throws. */
export async function runStartupMaintenance(): Promise<void> {
  try {
    await purgeTrash();
  } catch (error) {
    console.error(t('Could not empty the trash'), error);
  }
}
