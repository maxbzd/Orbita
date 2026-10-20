import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AbortedError, manualBridge, sharedManualProvider } from '../../ai';
import { ThemeProvider } from '../../styles/theme';
import { ToastProvider } from '../../ui/primitives';
import { ManualPaste } from './ManualPaste';

const schema = z.object({ title: z.string() });

function ask(): Promise<{ data: { title: string } }> {
  return sharedManualProvider.structured({
    system: 'Разбери запись.',
    user: 'Решил поднять цену.',
    schemaName: 'test',
    jsonSchema: { type: 'object', properties: { title: { type: 'string' } } },
    zod: schema,
    purpose: 'extract',
    tier: 'fast',
  });
}

function renderPanel() {
  return render(
    <ThemeProvider>
      <ToastProvider>
        <ManualPaste captureId="c1" />
      </ToastProvider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined), readText: vi.fn().mockResolvedValue('{"title":"Из буфера"}') } });
});
afterEach(() => manualBridge.cancelPending());

describe('«через буфер обмена»', () => {
  it('waits quietly while there is no request', () => {
    renderPanel();
    expect(screen.getByTestId('manual-wait')).toBeInTheDocument();
  });

  it('shows the ready prompt, copies it, and takes the pasted answer through the same validation as an API answer', async () => {
    const answer = ask();
    renderPanel();

    expect(await screen.findByTestId('manual-paste')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Скопировать запрос' }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('Решил поднять цену.')));
    expect(await screen.findByText('Запрос скопирован.')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox', { name: 'Ответ ИИ' }), { target: { value: '{"title":"Цена на тестовый урок"}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Вставить ответ' }));

    expect((await answer).data).toEqual({ title: 'Цена на тестовый урок' });
    await waitFor(() => expect(screen.getByTestId('manual-wait')).toBeInTheDocument());
  });

  it('a bad paste does not fail anything: the problem is shown, with a repair prompt, and the panel waits for another try', async () => {
    const answer = ask();
    renderPanel();
    await screen.findByTestId('manual-paste');

    fireEvent.change(screen.getByRole('textbox', { name: 'Ответ ИИ' }), { target: { value: 'Конечно! Вот ваш JSON' } });
    fireEvent.click(screen.getByRole('button', { name: 'Вставить ответ' }));

    expect(await screen.findByText(/Не удалось разобрать ответ/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Скопировать запрос на исправление' })).toBeInTheDocument();
    expect(screen.getByTestId('manual-paste')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox', { name: 'Ответ ИИ' }), { target: { value: '{"title":"Со второй попытки"}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Вставить ответ' }));
    expect((await answer).data.title).toBe('Со второй попытки');
  });

  it('«Из буфера» fills the field from the clipboard', async () => {
    const answer = ask();
    renderPanel();
    await screen.findByTestId('manual-paste');
    fireEvent.click(screen.getByRole('button', { name: 'Из буфера' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Ответ ИИ' })).toHaveValue('{"title":"Из буфера"}'));
    fireEvent.click(screen.getByRole('button', { name: 'Вставить ответ' }));
    expect((await answer).data.title).toBe('Из буфера');
  });

  it('«Отмена» gives up: the request ends as an abort, and the capture waits', async () => {
    const answer = ask();
    const settled = answer.then(
      () => 'resolved',
      (error: unknown) => error,
    );
    renderPanel();
    await screen.findByTestId('manual-paste');

    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Отмена' })));

    expect(await settled).toBeInstanceOf(AbortedError);
  });
});
