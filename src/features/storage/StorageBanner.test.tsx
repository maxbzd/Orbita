import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { audioRepo, capturesRepo, db, wipeAll } from '../../db';
import { resolveFull, useStorageHealth } from '../../lib/storageHealth';
import { ToastProvider } from '../../ui';
import { StorageBanner } from './StorageBanner';

const Where = () => <span data-testid="where">{useLocation().pathname + useLocation().search}</span>;
const draw = () =>
  render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/today']}>
        <Where />
        <Routes>
          <Route path="*" element={<StorageBanner />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );

beforeEach(async () => {
  await wipeAll();
  resolveFull();
  useStorageHealth.setState({ usage: null, quota: null, failedAt: null });
});

async function oldRecording(): Promise<string> {
  const capture = await capturesRepo.create({ kind: 'voice', status: 'done', text: 'давно записанное' });
  await db.captures.update(capture.id, { createdAt: new Date(Date.now() - 60 * 86_400_000).toISOString() });
  await audioRepo.save(capture.id, new Blob([new Uint8Array(2_000_000)], { type: 'audio/webm' }));
  return capture.id;
}

describe('the notice about a full storage', () => {
  it('shows nothing while there is room', () => {
    draw();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/Хранилище/)).toBeNull();
  });

  it('says plainly that the last change was not saved, as an alert that cannot be closed away', async () => {
    draw();
    act(() => useStorageHealth.setState({ full: true, dismissed: true }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Хранилище переполнено');
    expect(alert).toHaveTextContent('Последнее изменение не сохранилось');
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('the early warning is a status and can be closed', async () => {
    draw();
    act(() => useStorageHealth.setState({ usage: 95, quota: 100 }));
    expect(await screen.findByText(/Хранилище почти заполнено/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull(); // a warning, not an alarm
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(screen.queryByText(/Хранилище почти заполнено/)).toBeNull();
  });

  it('a backup leads to Settings, Data', async () => {
    draw();
    act(() => useStorageHealth.setState({ full: true }));
    fireEvent.click(await screen.findByRole('button', { name: 'Сделать резервную копию' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/settings?section=data');
  });

  it('deleting old recordings asks first, says how many and how big, then deletes only the sound and clears the alert', async () => {
    const id = await oldRecording();
    draw();
    act(() => useStorageHealth.setState({ full: true }));
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить старые записи голоса' }));
    const dialog = await screen.findByRole('alertdialog').catch(() => screen.findByRole('dialog'));
    expect(dialog).toHaveTextContent('1');
    expect(dialog).toHaveTextContent('2 MB');
    expect(await audioRepo.getForCapture(id)).toBeDefined(); // nothing is deleted before the person agrees
    fireEvent.click(screen.getByRole('button', { name: 'Удалить записи голоса' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(await audioRepo.getForCapture(id)).toBeUndefined();
    expect((await capturesRepo.get(id))?.text).toBe('давно записанное');
  });

  it('says so when there is nothing old to delete, and changes nothing', async () => {
    draw();
    act(() => useStorageHealth.setState({ full: true }));
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить старые записи голоса' }));
    expect(await screen.findByText('Нет старых записей голоса для удаления')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
