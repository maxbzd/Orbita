import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  useCapture,
  useCaptureItems,
  useDecisionsToReview,
  useEntity,
  useFeed,
  useInbox,
  useOpenCommitments,
  usePeople,
  usePredictionsToResolve,
  useProposedCount,
  useSettings,
  useTrash,
} from './hooks';
import { wipeAll } from './maintenance';
import { capturesRepo, itemsRepo, peopleRepo } from './repos';
import { updateSettings } from './settings';

beforeEach(wipeAll);

describe('live queries', () => {
  it('start undefined, deliver the first result and follow later writes', async () => {
    const { result } = renderHook(() => useInbox());
    expect(result.current).toBeUndefined();
    await waitFor(() => expect(result.current).toEqual([]));

    let created = '';
    await act(async () => {
      created = (await capturesRepo.create({ kind: 'voice', text: '', status: 'raw' })).id;
    });
    await waitFor(() => expect(result.current?.map((capture) => capture.id)).toEqual([created]));

    await act(async () => {
      await capturesRepo.setStatus(created, 'done');
    });
    await waitFor(() => expect(result.current).toEqual([]));
  });

  it('groups the feed by day and re-queries when the filter changes by value', async () => {
    const person = await peopleRepo.create({ name: 'Маша' });
    await capturesRepo.create({ kind: 'text', text: 'a', day: '2026-10-06', personIds: [person.id] });
    await capturesRepo.create({ kind: 'text', text: 'b', day: '2026-10-07' });

    const { result, rerender } = renderHook(({ personId }: { personId?: string }) => useFeed({ personId }), {
      initialProps: {},
    });
    await waitFor(() => expect(result.current?.map((group) => group.day)).toEqual(['2026-10-07', '2026-10-06']));

    rerender({ personId: person.id });
    await waitFor(() => expect(result.current?.map((group) => group.day)).toEqual(['2026-10-06']));
  });

  it('serves one capture, null when there is none, and the items of a capture', async () => {
    const capture = await capturesRepo.create({ kind: 'text', text: 'a' });
    await itemsRepo.create({ kind: 'task', title: 'Первая', captureId: capture.id });

    const single = renderHook(() => useCapture(capture.id));
    const missing = renderHook(() => useCapture('nope'));
    const items = renderHook(() => useCaptureItems(capture.id));
    await waitFor(() => expect(single.result.current?.id).toBe(capture.id));
    await waitFor(() => expect(missing.result.current).toBeNull());
    await waitFor(() => expect(items.result.current?.map((item) => item.title)).toEqual(['Первая']));
  });

  it('serves commitments by direction, due predictions and decisions, and the proposed count', async () => {
    await itemsRepo.create({ kind: 'commitment', title: 'я должен', direction: 'i_owe' });
    await itemsRepo.create({ kind: 'commitment', title: 'мне должны', direction: 'owed_to_me' });
    await itemsRepo.create({ kind: 'prediction', title: 'p', probability: 0.5, dueAt: '2026-10-01T00:00:00.000Z' });
    await itemsRepo.create({ kind: 'decision', title: 'd', chosen: 'x', dueAt: '2026-10-01T00:00:00.000Z' });
    await itemsRepo.create({ kind: 'task', title: 't', status: 'proposed' });

    const until = '2026-10-07T00:00:00.000Z';
    const owe = renderHook(() => useOpenCommitments('i_owe'));
    const all = renderHook(() => useOpenCommitments());
    const predictions = renderHook(() => usePredictionsToResolve(until));
    const decisions = renderHook(() => useDecisionsToReview(until));
    const proposed = renderHook(() => useProposedCount());

    await waitFor(() => expect(owe.result.current?.map((item) => item.title)).toEqual(['я должен']));
    await waitFor(() => expect(all.result.current).toHaveLength(2));
    await waitFor(() => expect(predictions.result.current).toHaveLength(1));
    await waitFor(() => expect(decisions.result.current).toHaveLength(1));
    await waitFor(() => expect(proposed.result.current).toBe(1));
  });

  it('lists people, finds any entity by id and shows the trash', async () => {
    const person = await peopleRepo.create({ name: 'Маша' });
    const item = await itemsRepo.create({ kind: 'task', title: 'Убрать' });

    const people = renderHook(() => usePeople());
    const person$ = renderHook(() => useEntity(person.id));
    const item$ = renderHook(() => useEntity(item.id));
    const nothing = renderHook(() => useEntity('nope'));
    const trash = renderHook(() => useTrash());

    await waitFor(() => expect(people.result.current?.map((p) => p.name)).toEqual(['Маша']));
    await waitFor(() => expect(person$.result.current?.table).toBe('people'));
    await waitFor(() => expect(item$.result.current?.table).toBe('items'));
    await waitFor(() => expect(nothing.result.current).toBeNull());
    await waitFor(() => expect(trash.result.current).toEqual([]));

    await act(async () => {
      await itemsRepo.remove(item.id);
    });
    await waitFor(() => expect(trash.result.current?.map((entry) => entry.title)).toEqual(['Убрать']));
  });

  it('reflects settings changes, starting from the defaults', async () => {
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current?.theme).toBe('dark'));
    await act(async () => {
      await updateSettings({ theme: 'light' });
    });
    await waitFor(() => expect(result.current?.theme).toBe('light'));
  });
});
