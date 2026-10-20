import { newId } from '../../domain/ids';
import type { ContextPackPreset, ID } from '../../domain/types';
import { NotFoundError } from '../internal';
import { db } from '../schema';
import { t } from '../../i18n';

/** Defaults: no sections, a 14-day window, no person/project filter, full names, 8000 tokens. */
export type NewPreset = Pick<ContextPackPreset, 'name'> & Partial<Omit<ContextPackPreset, 'name'>>;
export type PresetPatch = Partial<Omit<ContextPackPreset, 'id'>>;

export async function create(input: NewPreset): Promise<ContextPackPreset> {
  const name = input.name.trim();
  if (name === '') throw new RangeError(t('The preset name cannot be empty'));
  const preset: ContextPackPreset = {
    sections: [],
    windowDays: 14,
    personIds: [],
    projectIds: [],
    privacy: 'full',
    maxTokens: 8000,
    ...input,
    id: input.id ?? newId(),
    name,
  };
  await db.presets.add(preset);
  return preset;
}

export async function get(id: ID): Promise<ContextPackPreset | undefined> {
  return db.presets.get(id);
}

export async function update(id: ID, patch: PresetPatch): Promise<ContextPackPreset> {
  return db.transaction('rw', db.presets, async () => {
    const preset = await db.presets.get(id);
    if (!preset) throw new NotFoundError('presets', id);
    const next = { ...preset, ...patch, id };
    await db.presets.put(next);
    return next;
  });
}

export async function list(): Promise<ContextPackPreset[]> {
  return (await db.presets.toArray()).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

/** Presets are settings, not records: deleted outright. */
export async function remove(id: ID): Promise<void> {
  await db.presets.delete(id);
}
