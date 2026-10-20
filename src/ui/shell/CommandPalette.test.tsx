import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandPalette } from './CommandPalette';
import type { CommandItem, CommandProvider } from './commandFilter';

const make = (id: string, title: string, run = vi.fn(), extra: Partial<CommandItem> = {}): CommandItem => ({ id, title, run, ...extra });

describe('CommandPalette', () => {
  it('is a combobox + listbox: focus stays in the field, the highlighted option is aria-activedescendant', () => {
    render(<CommandPalette open onClose={() => undefined} actions={[make('a', 'Первое'), make('b', 'Второе')]} />);
    const input = screen.getByRole('combobox');
    expect(input).toHaveFocus();
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    expect(input).toHaveAttribute('aria-activedescendant', options[0]!.id);
    expect(input).toHaveAttribute('aria-controls', screen.getByRole('listbox').id);
  });

  it('arrows move the highlight and wrap, Home/End jump', () => {
    render(<CommandPalette open onClose={() => undefined} actions={[make('a', 'Один'), make('b', 'Два'), make('c', 'Три')]} />);
    const input = screen.getByRole('combobox');
    const selected = () => screen.getAllByRole('option').findIndex((o) => o.getAttribute('aria-selected') === 'true');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(selected()).toBe(1);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(selected()).toBe(0); // wrapped
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(selected()).toBe(2);
    fireEvent.keyDown(input, { key: 'Home' });
    expect(selected()).toBe(0);
    fireEvent.keyDown(input, { key: 'End' });
    expect(selected()).toBe(2);
    expect(input).toHaveFocus();
  });

  it('Enter closes the palette and runs the highlighted item; a click does the same', () => {
    const first = vi.fn();
    const second = vi.fn();
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} actions={[make('a', 'Один', first), make('b', 'Два', second)]} />);
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    expect(second).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getAllByRole('option')[0]!);
    expect(first).toHaveBeenCalledTimes(1);
  });

  it('Escape closes it', () => {
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} actions={[make('a', 'Один')]} />);
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('filters while typing, resets the highlight, and explains an empty result', () => {
    render(<CommandPalette open onClose={() => undefined} actions={[make('a', 'Новая запись'), make('b', 'Настройки'), make('c', 'Люди')]} />);
    const input = screen.getByRole('combobox');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.change(input, { target: { value: 'нов' } });
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('Новая запись');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Найдено: 1');

    fireEvent.change(input, { target: { value: 'яяя' } });
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText(/Ничего не нашлось/)).toBeInTheDocument();
    expect(input).not.toHaveAttribute('aria-activedescendant');
    fireEvent.keyDown(input, { key: 'Enter' }); // nothing to run: no error
  });

  it('draws group headings once per group, and shortcut caps', () => {
    render(
      <CommandPalette
        open
        onClose={() => undefined}
        actions={[
          make('a', 'Новая запись', vi.fn(), { group: 'Действия', shortcut: ['Ctrl', 'Shift', 'R'] }),
          make('b', 'Сегодня', vi.fn(), { group: 'Перейти' }),
          make('c', 'Поток', vi.fn(), { group: 'Перейти' }),
        ]}
      />,
    );
    expect(screen.getAllByText('Перейти')).toHaveLength(1);
    expect(screen.getAllByText('Действия')).toHaveLength(1);
    expect(within(screen.getAllByRole('option')[0]!).getByText('Shift')).toBeInTheDocument();
  });

  it('starts fresh each time it opens', () => {
    const actions = [make('a', 'Один'), make('b', 'Два')];
    const { rerender } = render(<CommandPalette open onClose={() => undefined} actions={actions} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'дв' } });
    rerender(<CommandPalette open={false} onClose={() => undefined} actions={actions} />);
    rerender(<CommandPalette open onClose={() => undefined} actions={actions} />);
    expect(screen.getByRole('combobox')).toHaveValue('');
    expect(screen.getAllByRole('option')).toHaveLength(2);
  });
});

describe('CommandPalette providers', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('asks the providers after a pause and lists their results under the provider group', async () => {
    const search = vi.fn(async (query: string) => [make('r1', `Запись про ${query}`)]);
    const provider: CommandProvider = { id: 'captures', group: 'Записи', search };
    render(<CommandPalette open onClose={() => undefined} providers={[provider]} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    search.mockClear();

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'отпуск' } });
    expect(search).not.toHaveBeenCalled(); // debounced
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(search).toHaveBeenCalledTimes(1);
    expect(search.mock.calls[0]![0]).toBe('отпуск');
    expect(screen.getByRole('option')).toHaveTextContent('Запись про отпуск');
    expect(screen.getByText('Записи')).toBeInTheDocument();
  });

  it('aborts the previous request when the query changes and ignores its late answer', async () => {
    const signals: AbortSignal[] = [];
    let resolveFirst: (items: CommandItem[]) => void = () => undefined;
    const search = vi.fn((query: string, signal: AbortSignal) => {
      signals.push(signal);
      if (query === 'а') return new Promise<CommandItem[]>((resolve) => (resolveFirst = resolve));
      return Promise.resolve([make('new', 'Свежий результат')]);
    });
    render(<CommandPalette open onClose={() => undefined} providers={[{ id: 'p', search }]} debounceMs={50} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    search.mockClear();
    signals.length = 0;

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'а' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
    });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'аб' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
    });
    expect(signals[0]!.aborted).toBe(true);

    await act(async () => resolveFirst([make('old', 'Устаревший результат')]));
    expect(screen.queryByText('Устаревший результат')).toBeNull();
    expect(screen.getByText('Свежий результат')).toBeInTheDocument();
  });

  it('a failing provider does not blank the palette', async () => {
    const good: CommandProvider = { id: 'good', search: () => [make('ok', 'Рабочий')] };
    const bad: CommandProvider = { id: 'bad', search: () => Promise.reject(new Error('сеть')) };
    render(<CommandPalette open onClose={() => undefined} providers={[bad, good]} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(screen.getByText('Рабочий')).toBeInTheDocument();
  });
});
