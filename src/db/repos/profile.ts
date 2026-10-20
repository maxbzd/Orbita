import { nowISO } from '../../domain/dates';
import { normalizeForSearch } from '../../domain/text';
import type { GlossaryEntry, Profile } from '../../domain/types';
import { db } from '../schema';

export const PROFILE_ID = 'me';

export type ProfilePatch = Partial<Omit<Profile, 'id' | 'updatedAt'>>;

/** The profile before the user has filled anything in. `updatedAt` is the epoch: never saved. */
export function emptyProfile(): Profile {
  return {
    id: PROFILE_ID,
    name: '',
    about: '',
    goals: '',
    values: '',
    talkStyle: '',
    glossary: [],
    updatedAt: new Date(0).toISOString(),
  };
}

/** Trims terms and hints, drops empty terms and repeats (case, `ё` and spacing do not matter). */
export function cleanGlossary(glossary: readonly GlossaryEntry[]): GlossaryEntry[] {
  const seen = new Set<string>();
  const cleaned: GlossaryEntry[] = [];
  for (const entry of glossary) {
    const term = entry.term.trim();
    const key = normalizeForSearch(term);
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    const hint = entry.hint?.trim();
    cleaned.push(hint ? { term, hint } : { term });
  }
  return cleaned;
}

/** The stored profile, or an empty one. */
export async function get(): Promise<Profile> {
  return (await db.profile.get(PROFILE_ID)) ?? emptyProfile();
}

export async function save(patch: ProfilePatch): Promise<Profile> {
  return db.transaction('rw', db.profile, async () => {
    const current = await get();
    const next: Profile = {
      ...current,
      ...patch,
      id: PROFILE_ID,
      glossary: cleanGlossary(patch.glossary ?? current.glossary),
      updatedAt: nowISO(),
    };
    await db.profile.put(next);
    return next;
  });
}
