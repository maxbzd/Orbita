import { describe, expect, it, vi } from 'vitest';
import { AbortedError, BadResponseError } from '../errors';
import { ExtractionSchema, PatternsSchema, ReviewSchema, SCHEMA_NAMES, extractionJsonSchema, patternsJsonSchema, reviewJsonSchema } from '../prompts/schemas';
import { createMockLlmProvider } from './mock';
import type { Usage } from './types';

const TEXT = [
  'Сегодня гулял и думал про встречи.',
  'Решил поднять цену на тестовую сессию до 700 рублей, потому что бесплатные приходят и пропадают.',
  'Обещал Маше прислать план до пятницы.',
  'Иван обещал скинуть оплату завтра.',
  'Идея: сделать мини-курс для новичков.',
  'Думаю, что на встречу придёт не больше половины, вероятность 40%.',
  'Надо позвонить Пете завтра.',
  'Понял, что нельзя назначать встречи на вечер пятницы.',
  'Я очень устал, не выспался.',
].join(' ');

const extractionRequest = (text: string, context = '') => ({
  system: 'SYS',
  user: `${context}Сегодня: 2026-10-07 (среда).\nЗапись сделана: 2026-10-07 (среда). Вид: голосовая запись.\n\n## Запись\n<record>\n${text}\n</record>`,
  schemaName: SCHEMA_NAMES.extraction,
  jsonSchema: extractionJsonSchema,
  zod: ExtractionSchema,
  purpose: 'extract' as const,
});

describe('mock extraction', () => {
  const run = (text: string, context?: string) => createMockLlmProvider().structured(extractionRequest(text, context));

  it('finds a decision with its reason, quoting the text verbatim', async () => {
    const { data } = await run(TEXT);
    const decision = data.items.find((item) => item.kind === 'decision');
    expect(decision).toMatchObject({ kind: 'decision', chosen: expect.stringContaining('поднять цену'), reasons: ['бесплатные приходят и пропадают'] });
    for (const item of data.items) if (item.quote) expect(TEXT).toContain(item.quote);
  });

  it('tells the direction of commitments and resolves "до пятницы" and "завтра"', async () => {
    const { data } = await run(TEXT);
    const commitments = data.items.filter((item) => item.kind === 'commitment');
    expect(commitments).toHaveLength(2);
    expect(commitments[0]).toMatchObject({ direction: 'i_owe', counterparty: 'Маша', dueDate: '2026-10-09' });
    expect(commitments[1]).toMatchObject({ direction: 'owed_to_me', counterparty: 'Иван', dueDate: '2026-10-08' });
  });

  it('extracts ideas, predictions with a probability, tasks, lessons and mood', async () => {
    const { data } = await run(TEXT);
    expect(data.items.map((item) => item.kind)).toEqual(['decision', 'commitment', 'commitment', 'idea', 'prediction', 'task', 'lesson']);
    expect(data.items.find((item) => item.kind === 'prediction')).toMatchObject({ probability: 0.4 });
    expect(data.items.find((item) => item.kind === 'task')).toMatchObject({ people: ['Петя'], dueDate: '2026-10-08' });
    expect(data.mood).toMatchObject({ valence: -0.6, energy: 0.2, tags: expect.arrayContaining(['сон']) });
    expect(data.people.map((person) => person.name).sort()).toEqual(['Иван', 'Маша', 'Петя']);
    expect(data.tags).toContain('встречи');
    expect(data.title.length).toBeLessThanOrEqual(60);
  });

  it('maps names onto known people and finds known projects', async () => {
    const context = '## Известные люди\n- Маша Иванова — parent\n\n## Известные проекты\n- Маяк — слова: школа\n\n';
    const { data } = await run('Обещал Маше прислать отчёт. Запустил рекламу для Маяк.', context);
    expect(data.people.map((person) => person.name)).toEqual(['Маша Иванова']);
    expect(data.items[0]).toMatchObject({ kind: 'commitment', counterparty: 'Маша Иванова', people: ['Маша Иванова'] });
    expect(data.projects.map((project) => project.name)).toEqual(['Маяк']);
  });

  it('is deterministic and returns nothing for small talk', async () => {
    expect(await run(TEXT)).toEqual(await run(TEXT));
    const empty = await run('Привет, как дела у всех тут?');
    expect(empty.data.items).toEqual([]);
    expect(empty.data.mood).toBeNull();
  });

  it('reports plausible usage through the sink', async () => {
    const onUsage = vi.fn<(usage: Usage, purpose: string) => void>();
    const provider = createMockLlmProvider({ onUsage });
    const { usage } = await provider.structured(extractionRequest(TEXT));
    expect(usage).toMatchObject({ provider: 'mock' });
    expect(usage.inputTokens).toBeGreaterThan(0);
    expect(onUsage).toHaveBeenCalledWith(usage, 'extract');
  });
});

describe('mock review and patterns', () => {
  it('writes a review from the digest numbers', async () => {
    const digest = { stats: { captures: 7 }, wins: ['a', 'b'], overdue: [{ title: 'Отправить КП Ивану' }] };
    const { data } = await createMockLlmProvider().structured({
      system: 'SYS',
      user: `Период: неделя\n\n## Сводка периода (JSON)\n${JSON.stringify(digest)}`,
      schemaName: SCHEMA_NAMES.review,
      jsonSchema: reviewJsonSchema,
      zod: ReviewSchema,
      purpose: 'review',
    });
    expect(data.headline).toBe('7 записей и 2 закрытых дел за период');
    expect(data.sections[1].body).toContain('Отправить КП Ивану');
    expect(data.questions[0]).toContain('Отправить КП Ивану');
  });

  it('finds topics repeated on different days and reuses known patterns', async () => {
    const user = [
      '## Известные паттерны',
      '- p1 [кандидат, recurring_topic] Повторяющаяся тема: цены: уже видели',
      '',
      '## Записи (от старых к новым)',
      '### c1 — 2026-10-01 — Цены\nСводка\nТеги: цены, тестовые',
      '### c2 — 2026-10-03 — Пробные\nСводка\nТеги: тестовые',
      '### c3 — 2026-10-03 — Ещё\nСводка\nТеги: цены',
      '### c4 — 2026-10-04 — Один\nСводка\nТеги: сон',
    ].join('\n\n');
    const { data } = await createMockLlmProvider().structured({
      system: 'SYS',
      user,
      schemaName: SCHEMA_NAMES.patterns,
      jsonSchema: patternsJsonSchema,
      zod: PatternsSchema,
      purpose: 'patterns',
    });
    expect(data.patterns.map((pattern) => pattern.title).sort()).toEqual(['Повторяющаяся тема: тестовые', 'Повторяющаяся тема: цены']);
    expect(data.patterns.find((pattern) => pattern.title.endsWith('цены'))).toMatchObject({ existingId: 'p1' });
    expect(data.patterns.find((pattern) => pattern.title.endsWith('тестовые'))?.evidence.map((e) => e.ref)).toEqual(['c1', 'c2']);
  });

  it('rejects schemas it does not know', async () => {
    const provider = createMockLlmProvider();
    await expect(provider.structured({ ...extractionRequest('x'), schemaName: 'other' })).rejects.toBeInstanceOf(BadResponseError);
  });
});

describe('mock chat', () => {
  it('answers "ask" from the materials with their codes, streaming word by word', async () => {
    const tokens: string[] = [];
    const result = await createMockLlmProvider().chat({
      system: 'ПРАВИЛА\n\nМАТЕРИАЛЫ\n[c1] Запись про цены\n[i2] Обещал Маше план',
      messages: [{ role: 'user', content: 'Что я обещал?' }],
      purpose: 'ask',
      onToken: (token) => tokens.push(token),
    });
    expect(result.text).toContain('Запись про цены [c1]');
    expect(result.text).toContain('Обещал Маше план [i2]');
    expect(tokens.join('')).toBe(result.text);
    expect(tokens.length).toBeGreaterThan(3);
  });

  it('says so when there is nothing to answer from', async () => {
    const result = await createMockLlmProvider().chat({ system: 'ПРАВИЛА', messages: [{ role: 'user', content: '?' }], purpose: 'ask' });
    expect(result.text).toBe('В записях ничего не нашлось по этому вопросу.');
  });

  it('honors cancellation and test()', async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = createMockLlmProvider();
    await expect(provider.chat({ system: '', messages: [], purpose: 'ask', signal: controller.signal })).rejects.toBeInstanceOf(AbortedError);
    expect(await provider.test()).toMatchObject({ ok: true });
  });
});

describe('mock extraction in English', () => {
  const EN = [
    'Today I decided to raise the price of the trial session to 700, because free ones come and vanish.',
    'I promised Anna to send the plan by Friday.',
    'John promised to send the payment tomorrow.',
    'Idea: make a mini-course for beginners.',
    'I think that no more than half will come, probability 40%.',
    'I need to call Pete tomorrow.',
    'I realized that meetings should not be set for Friday evening.',
    "I'm very tired, didn't sleep.",
  ].join(' ');

  it('finds the same kinds of objects in English text', async () => {
    const { data } = await createMockLlmProvider().structured({
      ...extractionRequest(EN),
      user: `Today: 2026-10-07 (Wednesday).\nRecord made: 2026-10-07 (Wednesday).\n\n## Record\n<record>\n${EN}\n</record>`,
    });
    expect(data.items.map((item) => item.kind)).toEqual(['decision', 'commitment', 'commitment', 'idea', 'prediction', 'task', 'lesson']);
    expect(data.items.filter((item) => item.kind === 'commitment')).toMatchObject([
      { direction: 'i_owe', counterparty: 'Anna', dueDate: '2026-10-09' },
      { direction: 'owed_to_me', counterparty: 'John', dueDate: '2026-10-08' },
    ]);
    expect(data.items.find((item) => item.kind === 'prediction')).toMatchObject({ probability: 0.4 });
    expect(data.mood).toMatchObject({ valence: -0.6, energy: 0.2 });
    expect(data.people.map((person) => person.name).sort()).toEqual(['Anna', 'John', 'Pete']);
  });
});
