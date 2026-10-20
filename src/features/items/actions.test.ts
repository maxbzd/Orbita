import { beforeEach, describe, expect, it } from 'vitest';
import { itemsRepo, linksRepo } from '../../db';
import { wipeAll } from '../../db/maintenance';
import type { ItemOfKind } from '../../domain/types';
import { clearDuplicate, findDuplicateCandidates, ideaToTask, mergeIdea, setIdeaStage, supersedeFact } from './actions';
import { predictionReport, summarizeCalibration } from './model';

beforeEach(wipeAll);

const newIdea = async (title: string, extra: Partial<ItemOfKind<'idea'>> = {}) => (await itemsRepo.create({ kind: 'idea', title, ...extra })) as ItemOfKind<'idea'>;

describe('слияние дублей идей', () => {
  it('источник становится отброшенным дублем, цель получает людей, проекты и теги, а «Вернуть» всё откатывает', async () => {
    const target = await newIdea('Интенсив к OKR в ноябре', { personIds: ['p1'], tags: ['okr'] });
    const source = await newIdea('Интенсив по OKR в ноябре', { personIds: ['p2'], projectIds: ['pr1'], tags: ['okr', 'интенсив'] });

    const undo = await mergeIdea(source.id, target.id);

    expect(await itemsRepo.get(source.id)).toMatchObject({ status: 'dropped', stage: 'dropped', duplicateOf: target.id });
    expect(await itemsRepo.get(target.id)).toMatchObject({ personIds: ['p1', 'p2'], projectIds: ['pr1'], tags: ['okr', 'интенсив'] });
    expect(await linksRepo.listFrom(source.id)).toMatchObject([{ to: target.id, kind: 'duplicate' }]);
    // The merged idea is out of the open lists but is still there.
    expect((await itemsRepo.list({ kind: 'idea', status: 'active' })).map((i) => i.id)).toEqual([target.id]);

    await undo();
    const restored = (await itemsRepo.get(source.id)) as ItemOfKind<'idea'>;
    expect(restored).toMatchObject({ status: 'active', stage: 'spark' });
    expect(restored.duplicateOf).toBeUndefined();
    expect(await itemsRepo.get(target.id)).toMatchObject({ personIds: ['p1'], projectIds: [], tags: ['okr'] });
    expect(await linksRepo.listFrom(source.id)).toEqual([]);
  });

  it('не сливает идею с самой собой и не-идеи', async () => {
    const one = await newIdea('Одна');
    const task = await itemsRepo.create({ kind: 'task', title: 'Задача' });
    await expect(mergeIdea(one.id, one.id)).rejects.toThrow();
    await expect(mergeIdea(one.id, task.id)).rejects.toThrow();
  });

  it('находит похожие идеи и не предлагает отброшенные и саму идею', async () => {
    const a = await newIdea('Запустить интенсив по OKR в ноябре');
    const b = await newIdea('Запустить интенсив для OKR в ноябре');
    const far = await newIdea('Купить новый микрофон');
    const dropped = await newIdea('Запустить интенсив по OKR в ноябре!', { status: 'dropped', stage: 'dropped' });
    const found = findDuplicateCandidates(a, await itemsRepo.list({ kind: 'idea' }));
    expect(found.map((m) => m.item.id)).toEqual([b.id]);
    expect(found.map((m) => m.item.id)).not.toContain(far.id);
    expect(found.map((m) => m.item.id)).not.toContain(dropped.id);
  });

  it('«Не дубль» забывает догадку ИИ', async () => {
    const target = await newIdea('Курс');
    const guess = await newIdea('Курс онлайн', { duplicateOf: target.id });
    expect(((await clearDuplicate(guess.id)) as ItemOfKind<'idea'>).duplicateOf).toBeUndefined();
  });
});

describe('идея → задача', () => {
  it('задача хранит цитату и источник, идея уходит «в работу», есть связь', async () => {
    const idea = await newIdea('Записать вебинар', { captureId: 'c1', quote: 'надо записать вебинар', personIds: ['p1'] });
    const task = await ideaToTask(idea);
    expect(task).toMatchObject({ kind: 'task', title: 'Записать вебинар', captureId: 'c1', quote: 'надо записать вебинар', personIds: ['p1'], status: 'active' });
    expect(await itemsRepo.get(idea.id)).toMatchObject({ stage: 'doing' });
    expect(await linksRepo.listFor(idea.id)).toMatchObject([{ from: task.id, to: idea.id, kind: 'follows' }]);
  });

  it('отброшенная идея возвращается в открытые, когда стадию меняют', async () => {
    const idea = await newIdea('Вернусь', { status: 'dropped', stage: 'dropped' });
    await setIdeaStage(idea, 'exploring');
    expect(await itemsRepo.get(idea.id)).toMatchObject({ stage: 'exploring', status: 'active' });
  });
});

describe('факт: замена значения', () => {
  it('новый факт заменяет старый, старый остаётся как устаревший', async () => {
    const old = (await itemsRepo.create({ kind: 'fact', title: 'Клиентов', value: '14' })) as ItemOfKind<'fact'>;
    const next = await supersedeFact(old, ' 16 ');
    expect(next).toMatchObject({ title: 'Клиентов', value: '16', status: 'active' });
    expect(await itemsRepo.get(old.id)).toMatchObject({ supersededBy: next.id, status: 'dropped' });
  });
});

describe('закрытие прогноза и калибровка', () => {
  it('«сбылось/нет» считаются, «неизвестно» нет; пять закрытых открывают график', async () => {
    const make = (probability: number) => itemsRepo.create({ kind: 'prediction', title: `p${probability}`, probability });
    const [a, b, c, d, e, f] = await Promise.all([make(0.9), make(0.8), make(0.7), make(0.6), make(0.2), make(0.5)]);
    await itemsRepo.resolvePrediction(a!.id, 'true');
    await itemsRepo.resolvePrediction(b!.id, 'true');
    await itemsRepo.resolvePrediction(c!.id, 'false', 'не вышло');
    await itemsRepo.resolvePrediction(d!.id, 'true');
    await itemsRepo.resolvePrediction(f!.id, 'unknown');

    let predictions = await itemsRepo.list({ kind: 'prediction' });
    expect(summarizeCalibration(predictionReport(predictions))).toMatchObject({ enough: false, headline: 'Мало данных' });

    await itemsRepo.resolvePrediction(e!.id, 'false');
    predictions = await itemsRepo.list({ kind: 'prediction' });
    const summary = summarizeCalibration(predictionReport(predictions));
    expect(summary.enough).toBe(true);
    // (0.1² + 0.2² + 0.7² + 0.4² + 0.2²) / 5 = 0.148
    expect(summary.brier).toBe('0,15');

    const closed = await itemsRepo.get(c!.id);
    expect(closed).toMatchObject({ status: 'done', outcome: 'false', resolutionNote: 'не вышло' });
  });
});

describe('пересмотр решения', () => {
  it('итог (1–5 + заметка) закрывает решение, «Вернуть» открывает его снова', async () => {
    const decision = await itemsRepo.create({ kind: 'decision', title: 'Поднять цену', chosen: 'Да', dueAt: '2026-10-01T00:00:00.000Z' });
    await itemsRepo.closeDecision(decision.id, { rating: 4, note: 'Ушло двое, пришло трое' });
    expect(await itemsRepo.get(decision.id)).toMatchObject({ status: 'done', outcome: { rating: 4, note: 'Ушло двое, пришло трое' } });
    expect(await itemsRepo.listDecisionsToReview('2026-10-08T00:00:00.000Z')).toEqual([]);
    await itemsRepo.reopen(decision.id);
    expect(((await itemsRepo.get(decision.id)) as ItemOfKind<'decision'>).outcome).toBeUndefined();
  });
});
