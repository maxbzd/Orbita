import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { capturesRepo, itemsRepo, peopleRepo, presetsRepo, profileRepo, updateSettings, wipeAll } from '../../db';
import { ThemeProvider } from '../../styles/theme';
import { ToastProvider } from '../../ui';
import ContextScreen from './ContextScreen';

function renderScreen(path = '/context') {
  return render(
    <ThemeProvider>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <ContextScreen />
        </MemoryRouter>
      </ToastProvider>
    </ThemeProvider>,
  );
}

const preview = (): HTMLElement => screen.getByTestId('context-preview');
const counter = (): string => screen.getByRole('region', { name: 'Размер контекста' }).textContent?.replace(/\s+/g, ' ') ?? '';

beforeEach(async () => {
  await wipeAll();
  await profileRepo.save({ name: 'Фёдор', about: 'Консультант по продуктам' });
  const masha = await peopleRepo.create({ name: 'Мария Иванова' });
  const denis = await peopleRepo.create({ name: 'Денис Громов' });
  const capture = await capturesRepo.create({ kind: 'text', text: 'Позвонила Мария Иванова, спросила про цену', status: 'done' });
  await itemsRepo.create({ kind: 'commitment', direction: 'i_owe', title: 'Отправить Марии Ивановой программу', status: 'active', personIds: [masha.id], captureId: capture.id });
  await itemsRepo.create({ kind: 'commitment', direction: 'i_owe', title: 'Вернуть Денису Громову деньги', status: 'active', personIds: [denis.id], captureId: capture.id });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('context builder', () => {
  it('builds the pack and shows its size in tokens against the budget', async () => {
    renderScreen();
    await waitFor(() => expect(preview().textContent).toContain('# Контекст для ИИ'));
    expect(preview().textContent).toContain('Отправить Марии Ивановой программу');
    const match = /(\d[\d ]*) \/ 8 000/.exec(counter());
    expect(match).not.toBeNull();
    expect(Number(match![1].replace(/\s/g, ''))).toBeGreaterThan(20);
  });

  it('changing the privacy level changes the names in the preview and warns about the limits', async () => {
    renderScreen();
    await waitFor(() => expect(preview().textContent).toContain('Мария Иванова'));

    fireEvent.click(screen.getByRole('radio', { name: 'Инициалы' }));
    await waitFor(() => expect(preview().textContent).not.toContain('Мария Иванова'));
    expect(preview().textContent).toContain('М. И.');

    fireEvent.click(screen.getByRole('radio', { name: 'Человек A' }));
    await waitFor(() => expect(preview().textContent).toMatch(/Человек [AB]/));
    expect(preview().textContent).not.toContain('Денис');
    expect(screen.getByRole('list', { name: 'Предупреждения' })).toBeInTheDocument();
  });

  it('a small budget cuts the pack and says so; the counter never exceeds it', async () => {
    renderScreen();
    await waitFor(() => expect(preview().textContent).toContain('Контекст'));
    fireEvent.click(screen.getByRole('radio', { name: '2k' }));
    await waitFor(() => expect(counter()).toMatch(/\/ 2 000/));
    const used = Number(/(\d[\d ]*) \/ 2 000/.exec(counter())![1].replace(/\s/g, ''));
    expect(used).toBeLessThanOrEqual(2000);
  });

  it('sections are chips: turning one off removes it from the preview', async () => {
    renderScreen();
    await waitFor(() => expect(preview().textContent).toContain('## Открытые обязательства'));
    fireEvent.click(within(screen.getByRole('group', { name: 'Разделы' })).getByRole('button', { name: /Открытые обязательства/ }));
    await waitFor(() => expect(preview().textContent).not.toContain('## Открытые обязательства'));
    expect(preview().textContent).toContain('## Профиль');
  });

  it('JSON format shows the same pack as data', async () => {
    renderScreen();
    await waitFor(() => expect(preview().textContent).toContain('# Контекст'));
    fireEvent.click(screen.getByRole('radio', { name: 'JSON' }));
    await waitFor(() => expect(JSON.parse(preview().textContent ?? '')).toMatchObject({ version: 1, privacy: 'full' }));
  });

  it('copies the preview text to the clipboard, and has a fallback when the clipboard is closed', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    renderScreen();
    await waitFor(() => expect(preview().textContent).toContain('# Контекст'));
    fireEvent.click(screen.getByRole('button', { name: 'Скопировать' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0]![0]).toBe(preview().textContent);
    expect(await screen.findByText(/Скопировано/)).toBeInTheDocument();

    writeText.mockRejectedValue(new Error('denied'));
    const exec = vi.fn().mockReturnValue(true);
    (document as unknown as { execCommand: typeof exec }).execCommand = exec;
    fireEvent.click(screen.getByRole('button', { name: 'Скопировать' }));
    await waitFor(() => expect(exec).toHaveBeenCalledWith('copy'));
  });

  it('a deep link for a person applies that person\'s preset', async () => {
    const [person] = (await peopleRepo.list()).filter((entry) => entry.name === 'Денис Громов');
    renderScreen(`/context?person=${person!.id}`);
    expect(await screen.findByRole('button', { name: 'Перед разговором: Денис Громов', pressed: true })).toBeInTheDocument();
    await waitFor(() => expect(preview().textContent).toContain('Вернуть Денису Громову деньги'));
    expect(preview().textContent).not.toContain('Отправить Марии Ивановой программу');
  });

  it('starts from the privacy level of the settings', async () => {
    await updateSettings({ privacy: { contextLevel: 'initials' } });
    renderScreen();
    expect(await screen.findByRole('radio', { name: 'Инициалы', checked: true })).toBeInTheDocument();
  });

  it('saves the current setup as a preset and deletes it', async () => {
    renderScreen();
    await waitFor(() => expect(preview().textContent).toContain('# Контекст'));
    fireEvent.click(screen.getByRole('radio', { name: '30 дн.' }));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить текущие настройки' }));
    const sheet = await screen.findByRole('dialog', { name: 'Сохранить пресет' });
    fireEvent.change(within(sheet).getByLabelText('Название'), { target: { value: 'Месяц' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Сохранить' }));
    await waitFor(async () => expect((await presetsRepo.list()).map((p) => [p.name, p.windowDays])).toEqual([['Месяц', 30]]));

    fireEvent.click(await screen.findByRole('button', { name: 'Удалить пресет «Месяц»' }));
    await waitFor(async () => expect(await presetsRepo.list()).toHaveLength(0));
  });
});
