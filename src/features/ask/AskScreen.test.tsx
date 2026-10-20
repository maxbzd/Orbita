import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AskAnswer } from '../../ai';
import { RateLimitError } from '../../ai';
import { setSessionSecrets, updateSettings, wipeAll } from '../../db';
import { ThemeProvider } from '../../styles/theme';
import { ToastProvider } from '../../ui';
import AskScreen from './AskScreen';

const { askMock } = vi.hoisted(() => ({ askMock: vi.fn() }));
vi.mock('../../ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../ai')>()),
  ask: askMock,
  createLlmProvider: vi.fn(() => ({ id: 'mock' })),
}));

const usage = { provider: 'mock', model: 'm', inputTokens: 10, outputTokens: 5 };
const answerOf = (question: string, text: string, citations: AskAnswer['citations'] = []): AskAnswer => ({
  question,
  text,
  citations,
  unknownCodes: [],
  materials: { text: '', sources: citations },
  usage,
});
const capture = { code: 'c1', kind: 'capture', id: 'cap-1', label: 'Запись 5 окт.', mentions: 1 } as const;

function Where() {
  const { pathname, search } = useLocation();
  return <output data-testid="where">{pathname + search}</output>;
}

function renderAsk(path = '/ask') {
  return render(
    <ThemeProvider>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route
              path="*"
              element={
                <>
                  <AskScreen />
                  <Where />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </ThemeProvider>,
  );
}

beforeEach(async () => {
  askMock.mockReset();
  await wipeAll();
  setSessionSecrets(null);
  await updateSettings({ ai: { anthropic: { apiKey: 'sk-ant-test-key-1234' } } });
});

describe('asking', () => {
  it('sends the typed question and shows the answer with links to its sources', async () => {
    askMock.mockResolvedValueOnce(answerOf('Что я обещал?', 'Вы обещали позвонить Маше [c1].', [capture]));
    renderAsk();
    fireEvent.change(await screen.findByLabelText('Ваш вопрос'), { target: { value: 'Что я обещал?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить вопрос' }));

    // Once inside the sentence, once in the list of what the AI saw.
    const links = await screen.findAllByRole('link', { name: 'Запись: Запись 5 окт.' });
    expect(links).toHaveLength(2);
    for (const link of links) expect(link).toHaveAttribute('href', '/entry/cap-1');
    expect(links[0]!.closest('details')).toBeNull();
    expect(screen.getByText(/Вы обещали позвонить Маше/)).toBeInTheDocument();
    expect(screen.getByText('Что я обещал?')).toBeInTheDocument();
    expect(askMock.mock.calls[0]![0]).toBe('Что я обещал?');
  });

  it('a quick question asks at once', async () => {
    askMock.mockResolvedValueOnce(answerOf('Что мне должны?', 'Никто.'));
    renderAsk();
    fireEvent.click(await screen.findByRole('button', { name: 'Что мне должны?' }));
    expect(await screen.findByText('Никто.')).toBeInTheDocument();
  });

  it('never renders model text as HTML', async () => {
    askMock.mockResolvedValueOnce(answerOf('q', '<img src=x alt="взлом"> <script>window.hacked=1</script> **жирный**'));
    const { container } = renderAsk();
    fireEvent.click(await screen.findByRole('button', { name: 'Что мне должны?' }));
    await screen.findByText(/<img src=x/);
    expect(container.querySelector('img[alt="взлом"]')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('strong')).toBeNull();
    expect((window as unknown as { hacked?: number }).hacked).toBeUndefined();
  });

  it('streams the answer with the codes hidden, then shows the verified links', async () => {
    let finish: (answer: AskAnswer) => void = () => undefined;
    askMock.mockImplementationOnce(
      (_question: string, deps: { onToken?: (token: string) => void }) =>
        new Promise<AskAnswer>((resolve) => {
          deps.onToken?.('Вы обещали позвонить [c');
          finish = resolve;
        }),
    );
    renderAsk();
    fireEvent.click(await screen.findByRole('button', { name: 'Что мне должны?' }));

    expect(await screen.findByText('ИИ думает')).toBeInTheDocument();
    expect(await screen.findByText('Вы обещали позвонить')).toBeInTheDocument();
    expect(screen.queryByText(/\[c/)).not.toBeInTheDocument();

    await act(async () => finish(answerOf('q', 'Вы обещали позвонить [c1].', [capture])));
    expect((await screen.findAllByRole('link', { name: /Запись 5 окт\./ }))[0]).toBeInTheDocument();
    expect(screen.queryByText('ИИ думает')).not.toBeInTheDocument();
  });

  it('keeps the session history and passes finished turns to the model', async () => {
    askMock.mockResolvedValueOnce(answerOf('Первый?', 'Ответ один.')).mockResolvedValueOnce(answerOf('Второй?', 'Ответ два.'));
    renderAsk();
    fireEvent.click(await screen.findByRole('button', { name: 'Что мне должны?' }));
    await screen.findByText('Ответ один.');

    fireEvent.change(screen.getByLabelText('Ваш вопрос'), { target: { value: 'А что ещё?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить вопрос' }));
    await screen.findByText('Ответ два.');

    expect(screen.getByText('Ответ один.')).toBeInTheDocument();
    expect(askMock.mock.calls[1]![1].history).toEqual([
      { role: 'user', content: 'Что мне должны?' },
      { role: 'assistant', content: 'Ответ один.' },
    ]);
  });

  it('tells a failure in Russian and can retry', async () => {
    askMock.mockRejectedValueOnce(new RateLimitError()).mockResolvedValueOnce(answerOf('q', 'Теперь получилось.'));
    renderAsk();
    fireEvent.click(await screen.findByRole('button', { name: 'Что мне должны?' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/[а-я]/i);
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('Теперь получилось.')).toBeInTheDocument();
  });
});

describe('without a key', () => {
  it('explains what to do and links to the AI settings; nothing is sent', async () => {
    await updateSettings({ ai: { anthropic: { apiKey: '' } } });
    renderAsk();
    expect(await screen.findByText(/Не задан ключ Anthropic/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Что мне должны?' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Отправить вопрос' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Открыть настройки ИИ' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/settings?section=ai');
    expect(askMock).not.toHaveBeenCalled();
  });

  it('manual mode lets the question go (the answer comes through the clipboard)', async () => {
    await updateSettings({ ai: { provider: 'manual' } });
    askMock.mockResolvedValueOnce(answerOf('q', 'Ответ из чата.'));
    renderAsk();
    fireEvent.change(await screen.findByLabelText('Ваш вопрос'), { target: { value: 'Что я решил?' } });
    expect(screen.getByRole('button', { name: 'Отправить вопрос' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Отправить вопрос' }));
    expect(await screen.findByText('Ответ из чата.')).toBeInTheDocument();
  });
});

describe('?q= deep link', () => {
  it('asks once and clears the parameter', async () => {
    askMock.mockResolvedValue(answerOf('Что я решил про цены?', 'Решили поднять.'));
    renderAsk('/ask?q=Что я решил про цены?');
    expect(await screen.findByText('Решили поднять.')).toBeInTheDocument();
    expect(askMock).toHaveBeenCalledTimes(1);
    expect(askMock.mock.calls[0]![0]).toBe('Что я решил про цены?');
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/ask$/));
  });

  it('puts the question into the field when there is no key to ask with', async () => {
    await updateSettings({ ai: { anthropic: { apiKey: '' } } });
    renderAsk('/ask?q=Что я обещал?');
    await waitFor(() => expect(screen.getByLabelText('Ваш вопрос')).toHaveValue('Что я обещал?'));
    expect(askMock).not.toHaveBeenCalled();
  });
});

describe('answer sources', () => {
  it('lists what the AI saw, each as a link', async () => {
    const sources = [capture, { code: 'p2', kind: 'person', id: 'per-2', label: 'Маша', mentions: 0 } as const];
    askMock.mockResolvedValueOnce({ ...answerOf('q', 'Коротко [c1].', [capture]), materials: { text: '', sources } });
    renderAsk();
    fireEvent.click(await screen.findByRole('button', { name: 'Что мне должны?' }));
    const seen = await screen.findByText('Что видел ИИ: 2');
    const details = seen.closest('details')!;
    expect(within(details).getByRole('link', { name: 'Человек: Маша' })).toHaveAttribute('href', '/people/per-2');
  });
});
