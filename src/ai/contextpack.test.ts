import { beforeEach, describe, expect, it } from 'vitest';
import { capturesRepo, itemsRepo, patternsRepo, peopleRepo, presetsRepo, profileRepo, projectsRepo, wipeAll } from '../db';
import { estimateTokens } from '../domain/tokens';
import type { ID } from '../domain/types';
import {
  BUILTIN_PRESETS,
  CONTEXT_SECTIONS,
  DEFAULT_MAX_TOKENS,
  MIN_MAX_TOKENS,
  buildContextPack,
  isContextSection,
  normalizeOptions,
  optionsFromPreset,
  presetForPerson,
  seedBuiltinPresets,
} from './contextpack';

const NOW = new Date('2026-10-09T12:00:00Z');
const at = (day: string, time = '10:00:00') => `${day}T${time}Z`;

let mashaId: ID;
let igorId: ID;

async function seed() {
  await profileRepo.save({
    name: 'Фёдор',
    about: 'Консультант по математике, строю онлайн-школу.',
    goals: 'Выйти на 50 учеников',
    values: 'Честность',
    talkStyle: 'Коротко и по делу',
    glossary: [{ term: 'тестовое', hint: 'первое занятие' }],
  });
  const masha = await peopleRepo.create({ name: 'Мария Иванова', aliases: ['Маша'], role: 'parent', relationMood: 0.7, notes: 'Мама ученика Вани' });
  const igor = await peopleRepo.create({ name: 'Борис', role: 'teammate' });
  mashaId = masha.id;
  igorId = igor.id;

  const everest = await projectsRepo.create({ name: 'Маяк', kind: 'business', description: 'Онлайн-школа KPI', keywords: ['курс'] });
  await projectsRepo.create({ name: 'Закрытый', kind: 'other', status: 'done' });

  await capturesRepo.create({ kind: 'voice', day: '2026-10-08', createdAt: at('2026-10-08'), title: 'Звонок Маше', summary: 'Договорился с Машей о тестовом.', text: 'текст', personIds: [masha.id], projectIds: [everest.id] });
  await capturesRepo.create({ kind: 'text', day: '2026-10-06', createdAt: at('2026-10-06'), text: 'Борис предложил поднять цену.', personIds: [igor.id] });
  await capturesRepo.create({ kind: 'text', day: '2026-08-01', createdAt: at('2026-08-01'), text: 'Давняя запись', personIds: [igor.id] });

  await itemsRepo.create({ kind: 'commitment', title: 'Прислать план Маше', direction: 'i_owe', counterpartyId: masha.id, personIds: [masha.id], dueAt: at('2026-10-07'), createdAt: at('2026-10-05') });
  await itemsRepo.create({ kind: 'commitment', title: 'Борис пришлёт отчёт', direction: 'owed_to_me', counterpartyId: igor.id, personIds: [igor.id], dueAt: at('2026-10-15'), createdAt: at('2026-10-06') });
  await itemsRepo.create({ kind: 'commitment', title: 'Закрытое обещание', direction: 'i_owe', status: 'done', createdAt: at('2026-10-01') });
  await itemsRepo.create({ kind: 'commitment', title: 'Не разобрано', direction: 'i_owe', status: 'proposed', createdAt: at('2026-10-08') });
  await itemsRepo.create({ kind: 'decision', title: 'Поднять цену тестового', chosen: 'до 900', alternatives: ['оставить 700'], reasons: ['спрос'], createdAt: at('2026-10-06') });
  await itemsRepo.create({ kind: 'decision', title: 'Старое решение', chosen: 'так', createdAt: at('2026-07-01') });
  await itemsRepo.create({ kind: 'decision', title: 'Старое, но пора оценить', chosen: 'так', dueAt: at('2026-10-01'), createdAt: at('2026-07-02') });
  await itemsRepo.create({ kind: 'prediction', title: 'Борис вернётся к работе', probability: 0.7, dueAt: at('2026-10-20'), createdAt: at('2026-10-06') });
  await itemsRepo.create({ kind: 'idea', title: 'Мини-группа по KPI', stage: 'exploring', relatedIds: [], body: 'Для девятиклассников', createdAt: at('2026-10-05') });
  await itemsRepo.create({ kind: 'task', title: 'Обновить прайс', priority: 'high', createdAt: at('2026-10-05') });
  await itemsRepo.create({ kind: 'fact', title: 'Клиентов сейчас', value: '14', createdAt: at('2026-10-04') });

  await patternsRepo.create({ title: 'Откладывает звонки', description: 'Звонки переносятся на вечер', kind: 'behavior', status: 'confirmed', confidence: 0.7, occurrences: 3, suggestion: 'Звонить утром' });
  await patternsRepo.create({ title: 'Отклонённый паттерн', description: 'Нет', kind: 'other', status: 'rejected' });
}

const sectionTitles = (markdown: string): string[] => [...markdown.matchAll(/^## (.+)$/gm)].map((match) => match[1]);

beforeEach(wipeAll);

describe('options', () => {
  it('keeps known sections in document order, ignores unknown ones, and clamps numbers', () => {
    expect(normalizeOptions({ sections: ['recent', 'nonsense', 'profile'] }).sections).toEqual(['profile', 'recent']);
    expect(normalizeOptions({}).sections).toEqual([...CONTEXT_SECTIONS]);
    expect(normalizeOptions({ sections: ['nonsense'] }).sections).toEqual([...CONTEXT_SECTIONS]);
    expect(normalizeOptions({ maxTokens: 5, windowDays: 0 })).toMatchObject({ maxTokens: MIN_MAX_TOKENS, windowDays: 1 });
    expect(normalizeOptions({ windowDays: 99999 }).windowDays).toBe(3660);
    expect(normalizeOptions({})).toMatchObject({ maxTokens: DEFAULT_MAX_TOKENS, privacy: 'full', format: 'markdown' });
    expect(isContextSection('recent')).toBe(true);
    expect(isContextSection('x')).toBe(false);
  });
});

describe('buildContextPack', () => {
  beforeEach(seed);

  it('writes a readable markdown document with the profile and every section', async () => {
    const pack = await buildContextPack({ now: NOW, windowDays: 14 });
    expect(pack.trimmed).toBe(false);
    expect(sectionTitles(pack.markdown)).toEqual(['Профиль', 'Проекты', 'Открытые обязательства', 'Открытые задачи', 'Решения', 'Прогнозы', 'Идеи', 'Факты', 'Люди', 'Паттерны', 'Последние записи']);
    expect(pack.markdown).toContain('# Контекст для ИИ');
    expect(pack.markdown).toContain('**Имя:** Фёдор');
    expect(pack.markdown).toContain('**Термины и слова:** тестовое — первое занятие');
    expect(pack.markdown).toContain('- Маяк (бизнес, активный): Онлайн-школа KPI');
    expect(pack.markdown).not.toContain('Закрытый');
  });

  it('splits promises into two directions, overdue first, without closed or unreviewed ones', async () => {
    const { markdown } = await buildContextPack({ now: NOW, sections: ['commitments'] });
    expect(markdown).toContain('**Я должен**\n- Прислать план Маше — Мария Иванова · срок 2026-10-07, просрочено\n**Мне должны**\n- Борис пришлёт отчёт — Борис · срок 2026-10-15');
    expect(markdown).not.toContain('Закрытое обещание');
    expect(markdown).not.toContain('Не разобрано');
  });

  it('shows the details of decisions and predictions, and only decisions of the window or due for review', async () => {
    const { markdown } = await buildContextPack({ now: NOW, sections: ['decisions', 'predictions'], windowDays: 14 });
    expect(markdown).toContain('- 2026-10-06 — Поднять цену тестового. Выбрано: до 900. Альтернативы: оставить 700. Причины: спрос');
    expect(markdown).toContain('Старое, но пора оценить. Выбрано: так. Пора оценить, как вышло');
    expect(markdown).not.toContain('- 2026-07-01 — Старое решение');
    expect(markdown).toContain('- Борис вернётся к работе — 70% · срок 2026-10-20');
    // Due-for-review decisions come first.
    expect(markdown.indexOf('Старое, но пора оценить')).toBeLessThan(markdown.indexOf('Поднять цену тестового'));
  });

  it('describes people and patterns, leaving out rejected patterns', async () => {
    const { markdown } = await buildContextPack({ now: NOW, sections: ['people', 'patterns'] });
    expect(markdown).toContain('- Мария Иванова (родитель) — упоминаний: 1, последний раз 2026-10-08, отношения тёплые, я должен: 1. Мама ученика Вани');
    expect(markdown).toContain('- Откладывает звонки (подтверждён, 3 раз): Звонки переносятся на вечер. Что делать: Звонить утром');
    expect(markdown).not.toContain('Отклонённый паттерн');
  });

  it('lists only the records of the window', async () => {
    const week = await buildContextPack({ now: NOW, sections: ['recent'], windowDays: 7 });
    expect(week.markdown).toContain('2026-10-08 · Звонок Маше — Договорился с Машей о тестовом.');
    expect(week.markdown).toContain('2026-10-06 · Борис предложил поднять цену.');
    expect(week.markdown).not.toContain('Давняя запись');
    const day = await buildContextPack({ now: NOW, sections: ['recent'], windowDays: 2 });
    expect(day.markdown).not.toContain('Борис предложил');
  });

  it('narrows everything to the chosen people and projects', async () => {
    const { markdown, sections } = await buildContextPack({ now: NOW, personIds: [mashaId], sections: ['commitments', 'recent', 'people', 'predictions', 'patterns'] });
    expect(markdown).toContain('Прислать план Маше');
    expect(markdown).not.toContain('Борис пришлёт отчёт');
    expect(markdown).toContain('Звонок Маше');
    expect(markdown).not.toContain('Борис предложил');
    expect(markdown).not.toContain('Борис (коллега)');
    expect(sections.find((section) => section.id === 'predictions')?.total).toBe(0);
    expect(igorId).toBeTruthy();

    const byProject = await buildContextPack({ now: NOW, projectIds: [(await projectsRepo.list())[0].id], sections: ['recent', 'projects'] });
    expect(byProject.markdown).toContain('Звонок Маше');
    expect(byProject.markdown).not.toContain('Борис предложил');
  });

  it('gives the same document for the same data', async () => {
    const [a, b] = [await buildContextPack({ now: NOW, privacy: 'anonymous' }), await buildContextPack({ now: NOW, privacy: 'anonymous' })];
    expect(a.markdown).toBe(b.markdown);
    expect(a.json).toBe(b.json);
  });

  it('produces JSON that says the same as the markdown', async () => {
    const pack = await buildContextPack({ now: NOW, sections: ['profile', 'commitments'] });
    const parsed = JSON.parse(pack.json) as typeof pack.data;
    expect(parsed).toEqual(pack.data);
    expect(parsed).toMatchObject({ version: 1, privacy: 'full', trimmed: false, windowDays: 14 });
    expect(parsed.profile?.name).toBe('Фёдор');
    expect(parsed.sections.commitments).toEqual([
      { group: 'Я должен', title: 'Прислать план Маше', direction: 'i_owe', person: 'Мария Иванова', due: '2026-10-07', overdue: true },
      { group: 'Мне должны', title: 'Борис пришлёт отчёт', direction: 'owed_to_me', person: 'Борис', due: '2026-10-15', overdue: false },
    ]);
    expect(pack.tokens.markdown).toBe(estimateTokens(pack.markdown));
    expect(pack.tokens.json).toBe(estimateTokens(pack.json));
  });

  describe('privacy', () => {
    it('masks names to initials everywhere, in markdown and in JSON', async () => {
      const pack = await buildContextPack({ now: NOW, privacy: 'initials' });
      for (const text of [pack.markdown, pack.json]) {
        expect(text).not.toMatch(/Мария|Маша|Маше|Машей|Иванов|Игор|Фёдор/);
      }
      expect(pack.markdown).toContain('**Имя:** Ф.');
      expect(pack.markdown).toContain('Прислать план М. И. — М. И.');
      expect(pack.markdown).toContain('Б. вернётся к работе');
      expect(pack.warnings.join(' ')).toContain('Имена, которых в базе нет');
      expect(pack.data.privacy).toBe('initials');
    });

    it('replaces people with Человек A, B… and the author with Автор', async () => {
      const pack = await buildContextPack({ now: NOW, privacy: 'anonymous' });
      expect(pack.markdown).toContain('**Имя:** Автор');
      expect(pack.markdown).toContain('Человек A пришлёт отчёт');
      expect(pack.markdown).toContain('Прислать план Человек B — Человек B');
      expect(pack.markdown).toContain('Имена: обезличенные');
      expect(pack.json).not.toMatch(/Мария|Маша|Игор|Фёдор/);
    });

    it('keeps the labels the same in every section', async () => {
      const pack = await buildContextPack({ now: NOW, privacy: 'anonymous', sections: ['commitments', 'people', 'recent'] });
      const labels = new Set(pack.markdown.match(/Человек [A-Z]/g));
      expect([...labels].sort()).toEqual(['Человек A', 'Человек B']);
    });
  });

  describe('token budget', () => {
    async function bulk() {
      for (let index = 0; index < 40; index++) {
        await itemsRepo.create({ kind: 'commitment', title: `Обещание номер ${index} про занятия и оплату`, direction: index % 2 === 0 ? 'i_owe' : 'owed_to_me', dueAt: at('2026-10-20'), createdAt: at('2026-10-05', `10:${String(index).padStart(2, '0')}:00`) });
        await capturesRepo.create({ kind: 'text', day: '2026-10-07', createdAt: at('2026-10-07', `11:${String(index).padStart(2, '0')}:00`), text: `Запись номер ${index}. ${'Обсуждал занятия и цены. '.repeat(10)}` });
      }
    }

    it('fits the limit by cutting entries, important sections last, and says so', async () => {
      await bulk();
      const full = await buildContextPack({ now: NOW, maxTokens: 200_000 });
      expect(full.trimmed).toBe(false);
      expect(full.tokens.markdown).toBeGreaterThan(2_000);

      const pack = await buildContextPack({ now: NOW, maxTokens: 1_200 });
      expect(pack.trimmed).toBe(true);
      expect(pack.tokens.markdown).toBeLessThanOrEqual(1_200);
      expect(pack.markdown).toContain('Обрезано по лимиту в 1200 токенов');
      expect(pack.markdown).toContain('**Имя:** Фёдор');
      expect(pack.warnings[0]).toContain('сокращён до 1200 токенов');
      expect(pack.data.trimmed).toBe(true);

      const by = (id: string) => pack.sections.find((section) => section.id === id);
      expect(by('commitments')?.included).toBeGreaterThan(by('recent')?.included ?? 0);
      expect(by('recent')?.included).toBeLessThan(by('recent')?.total ?? 0);
      // Every section still has a voice instead of one starving another.
      expect(by('decisions')?.included).toBeGreaterThan(0);
      expect(by('predictions')?.included).toBeGreaterThan(0);
    });

    it('keeps the most urgent entries of a section when it is cut', async () => {
      await bulk();
      const pack = await buildContextPack({ now: NOW, sections: ['commitments'], maxTokens: 400 });
      expect(pack.markdown).toContain('Прислать план Маше');
    });

    it('applies the limit to JSON when JSON is what will be sent', async () => {
      await bulk();
      const pack = await buildContextPack({ now: NOW, maxTokens: 1_500, format: 'json' });
      expect(pack.trimmed).toBe(true);
      expect(pack.tokens.json).toBeLessThanOrEqual(1_500);
      expect(JSON.parse(pack.json)).toBeTruthy();
    });

    it('shortens a huge profile to its share of the budget', async () => {
      await profileRepo.save({ about: 'очень длинный текст о себе '.repeat(400), goals: 'цели '.repeat(300) });
      await bulk();
      const pack = await buildContextPack({ now: NOW, maxTokens: 800 });
      expect(pack.tokens.markdown).toBeLessThanOrEqual(800);
      expect(pack.markdown).toContain('…');
      expect(pack.sections.find((section) => section.id === 'commitments')?.included).toBeGreaterThan(0);
    });

    it('does not trim anything when it all fits', async () => {
      const pack = await buildContextPack({ now: NOW, maxTokens: 50_000 });
      expect(pack.trimmed).toBe(false);
      expect(pack.markdown).not.toContain('Обрезано');
      expect(pack.sections.every((section) => section.included === section.total)).toBe(true);
    });
  });

  it('copes with an empty database', async () => {
    await wipeAll();
    const pack = await buildContextPack({ now: NOW });
    expect(pack.markdown).toContain('# Контекст для ИИ');
    expect(sectionTitles(pack.markdown)).toEqual([]);
    expect(pack.trimmed).toBe(false);
  });
});

describe('presets', () => {
  it('are made of known sections and sensible numbers', () => {
    expect(BUILTIN_PRESETS.map((preset) => preset.name)).toEqual(['Утренний разбор', 'Недельный обзор', 'Стратегическая сессия']);
    for (const preset of BUILTIN_PRESETS) {
      expect(preset.sections.every(isContextSection)).toBe(true);
      expect(preset.maxTokens).toBeGreaterThanOrEqual(MIN_MAX_TOKENS);
    }
  });

  it('builds one for a talk with a person', () => {
    const preset = presetForPerson({ id: 'p1', name: 'Мария' });
    expect(preset).toMatchObject({ name: 'Перед разговором: Мария', personIds: ['p1'] });
    expect(optionsFromPreset(preset)).toMatchObject({ personIds: ['p1'], windowDays: 60, privacy: 'full' });
  });

  it('are stored once and never twice', async () => {
    expect(await seedBuiltinPresets()).toHaveLength(3);
    expect(await seedBuiltinPresets()).toEqual([]);
    expect(await presetsRepo.list()).toHaveLength(3);
    await presetsRepo.remove((await presetsRepo.list())[0].id);
    expect(await seedBuiltinPresets()).toHaveLength(1);
  });

  it('build a pack with the options they carry', async () => {
    await seed();
    const [morning] = BUILTIN_PRESETS;
    const pack = await buildContextPack({ ...optionsFromPreset(morning), now: NOW });
    expect(sectionTitles(pack.markdown)).toEqual(['Профиль', 'Открытые обязательства', 'Открытые задачи', 'Решения', 'Прогнозы', 'Последние записи']);
  });
});
