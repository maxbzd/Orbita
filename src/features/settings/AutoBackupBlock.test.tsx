import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getStoredSettings, resetSettings } from '../../db';
import { ToastProvider } from '../../ui';

const folder = vi.hoisted(() => ({ supported: true, picked: { name: 'Документы' } as { name: string } | null, written: 0 }));
vi.mock('../../lib/folder', () => ({
  folderBackupSupported: () => folder.supported,
  pickFolder: async () => folder.picked,
  folderAccess: async () => 'granted',
  forgetFolder: async () => undefined,
  writeToFolder: async () => {
    folder.written += 1;
  },
}));

import { AutoBackupBlock } from './AutoBackupBlock';

const draw = () =>
  render(
    <ToastProvider>
      <AutoBackupBlock />
    </ToastProvider>,
  );

beforeEach(async () => {
  await resetSettings();
  folder.supported = true;
  folder.picked = { name: 'Документы' };
  folder.written = 0;
});

describe('automatic copies in Settings', () => {
  it('says so where the browser cannot write into a folder', () => {
    folder.supported = false;
    draw();
    expect(screen.getByText(/Нужен Chrome/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Настроить' })).toBeNull();
  });

  it('checks the passphrase first, then picks a folder, writes the first copy and shows when it was made', async () => {
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'Настроить' }));
    fireEvent.change(await screen.findByLabelText('Парольная фраза для копий'), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать папку' }));
    expect(await screen.findByText(/Используй не меньше 8 символов/)).toBeInTheDocument();
    expect(folder.written).toBe(0);

    fireEvent.change(screen.getByLabelText('Парольная фраза для копий'), { target: { value: 'длинная парольная фраза' } });
    fireEvent.change(screen.getByLabelText('Повторите'), { target: { value: 'другая' } });
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать папку' }));
    expect(await screen.findByText(/не совпадают/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Повторите'), { target: { value: 'длинная парольная фраза' } });
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать папку' }));
    await waitFor(async () => expect((await getStoredSettings()).autoBackup?.folder).toBe('Документы'));
    await waitFor(() => expect(folder.written).toBe(1));
    expect(JSON.stringify(await getStoredSettings())).not.toContain('длинная парольная фраза'); // only the public half is kept
    expect(await screen.findByText(/Каждый день в «Документы»/)).toBeInTheDocument();
  });

  it('cancelling the folder picker changes nothing', async () => {
    folder.picked = null;
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'Настроить' }));
    fireEvent.change(await screen.findByLabelText('Парольная фраза для копий'), { target: { value: 'длинная парольная фраза' } });
    fireEvent.change(screen.getByLabelText('Повторите'), { target: { value: 'длинная парольная фраза' } });
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать папку' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Выбрать папку' })).not.toBeDisabled());
    expect((await getStoredSettings()).autoBackup).toBeNull();
  });

  it('turning it off forgets the folder', async () => {
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'Настроить' }));
    fireEvent.change(await screen.findByLabelText('Парольная фраза для копий'), { target: { value: 'длинная парольная фраза' } });
    fireEvent.change(screen.getByLabelText('Повторите'), { target: { value: 'длинная парольная фраза' } });
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать папку' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Выключить' }));
    await waitFor(async () => expect((await getStoredSettings()).autoBackup).toBeNull());
  });
});
