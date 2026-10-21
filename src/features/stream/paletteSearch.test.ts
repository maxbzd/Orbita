import { beforeEach, describe, expect, it, vi } from 'vitest';
import { capturesRepo, peopleRepo, wipeAll } from '../../db';
import { buildIndex } from '../../search';
import { createSearchProvider } from './paletteSearch';

beforeEach(wipeAll);

describe('palette search provider', () => {
  it('finds records and people and leads to their screens', async () => {
    const capture = await capturesRepo.create({ kind: 'text', text: 'Решил поднять цену на тестовое занятие', status: 'done' });
    const person = await peopleRepo.create({ name: 'Светлана Орлова', role: 'family' });
    await buildIndex();
    const go = vi.fn();
    const provider = createSearchProvider(go);

    const byText = await provider.search('цену', new AbortController().signal);
    expect(byText.map((item) => item.group)).toContain('Записи');
    byText.find((item) => item.group === 'Записи')?.run();
    expect(go).toHaveBeenLastCalledWith(`/entry/${capture.id}`);

    const byName = await provider.search('Светлане', new AbortController().signal);
    byName.find((item) => item.group === 'Люди')?.run();
    expect(go).toHaveBeenLastCalledWith(`/people/${person.id}`);
  });

  it('stays quiet for a one-letter query or an aborted one', async () => {
    const provider = createSearchProvider(vi.fn());
    expect(await provider.search('ц', new AbortController().signal)).toEqual([]);
    const controller = new AbortController();
    controller.abort();
    expect(await provider.search('цена', controller.signal)).toEqual([]);
  });
});
