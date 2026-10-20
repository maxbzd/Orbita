import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TOAST_DURATION, ToastProvider, useToast } from './Toast';
import type { ToastApi } from './Toast';

let api: ToastApi;
function Capture() {
  api = useToast();
  return null;
}

function setup() {
  return render(
    <ToastProvider>
      <Capture />
    </ToastProvider>,
  );
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const tick = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

describe('Toast', () => {
  it('keeps an always-mounted polite live region so announcements are spoken', () => {
    setup();
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('region', { name: 'Уведомления' })).toBeInTheDocument();
    act(() => void api.show({ message: 'Запись удалена' }));
    expect(screen.getByRole('status')).toHaveTextContent('Запись удалена');
  });

  it('uses an assertive alert for the danger tone', () => {
    setup();
    act(() => void api.show({ message: 'Не удалось сохранить', tone: 'danger' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Не удалось сохранить');
  });

  it('shows a toast for 5 seconds, then removes it and reports the timeout', () => {
    setup();
    const onClose = vi.fn();
    act(() => void api.show({ message: 'Готово', onClose }));
    expect(DEFAULT_TOAST_DURATION).toBe(5000);
    tick(4900);
    expect(screen.getByText('Готово')).toBeInTheDocument();
    tick(200);
    expect(screen.queryByText('Готово')).toBeNull();
    expect(onClose).toHaveBeenCalledExactlyOnceWith('timeout');
  });

  it('"Вернуть" runs the action once, closes the toast and does not report a timeout later', () => {
    setup();
    const onAction = vi.fn();
    const onClose = vi.fn();
    act(() => void api.show({ message: 'Обязательство удалено', onAction, onClose }));
    fireEvent.click(screen.getByRole('button', { name: 'Вернуть' }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Обязательство удалено')).toBeNull();
    tick(10_000);
    expect(onClose).toHaveBeenCalledExactlyOnceWith('action');
  });

  it('has no action button without an action and a custom label when asked', () => {
    setup();
    act(() => void api.show({ message: 'Просто сообщение' }));
    expect(screen.queryByRole('button', { name: 'Вернуть' })).toBeNull();
    act(() => api.clear());
    act(() => void api.show({ message: 'Архив', onAction: () => undefined, actionLabel: 'Отменить' }));
    expect(screen.getByRole('button', { name: 'Отменить' })).toBeInTheDocument();
  });

  it('queues toasts: one at a time, in order, each with its full time', () => {
    setup();
    act(() => {
      api.show({ message: 'Первое' });
      api.show({ message: 'Второе' });
      api.show({ message: 'Третье' });
    });
    expect(screen.getByText('Первое')).toBeInTheDocument();
    expect(screen.queryByText('Второе')).toBeNull();
    expect(screen.getByLabelText('Ещё уведомлений: 2')).toBeInTheDocument();

    tick(5100);
    expect(screen.queryByText('Первое')).toBeNull();
    expect(screen.getByText('Второе')).toBeInTheDocument();

    tick(4000); // the second has had 4 s: still there
    expect(screen.getByText('Второе')).toBeInTheDocument();
    tick(1200);
    expect(screen.getByText('Третье')).toBeInTheDocument();
  });

  it('closing with the x button shows the next one', () => {
    setup();
    const onClose = vi.fn();
    act(() => {
      api.show({ message: 'Первое', onClose });
      api.show({ message: 'Второе' });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть уведомление' }));
    expect(onClose).toHaveBeenCalledWith('dismiss');
    expect(screen.getByText('Второе')).toBeInTheDocument();
  });

  it('pauses the timer while the pointer is over the toast or focus is inside it', () => {
    setup();
    act(() => void api.show({ message: 'Читаю' }));
    tick(3000);
    const toast = screen.getByText('Читаю').closest('[data-tone]')!;
    fireEvent.pointerEnter(toast);
    tick(20_000);
    expect(screen.getByText('Читаю')).toBeInTheDocument();
    fireEvent.pointerLeave(toast);
    tick(1900); // 2 s were left
    expect(screen.getByText('Читаю')).toBeInTheDocument();
    tick(200);
    expect(screen.queryByText('Читаю')).toBeNull();
  });

  it('stays until dismissed with duration null', () => {
    setup();
    act(() => void api.show({ message: 'Не уходит', duration: null }));
    tick(60_000);
    expect(screen.getByText('Не уходит')).toBeInTheDocument();
  });

  it('a toast with an existing id replaces it instead of queueing a copy', () => {
    setup();
    const first = vi.fn();
    act(() => {
      api.show({ id: 'sync', message: 'Синхронизация…', onClose: first });
      api.show({ id: 'sync', message: 'Готово' });
    });
    expect(first).toHaveBeenCalledWith('replaced');
    expect(screen.getByText('Готово')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Ещё уведомлений/)).toBeNull();
  });

  it('dismiss(id) removes a queued toast and clear() empties the queue', () => {
    setup();
    let secondId = '';
    act(() => {
      api.show({ message: 'Первое' });
      secondId = api.show({ message: 'Второе' });
    });
    act(() => api.dismiss(secondId));
    expect(screen.queryByLabelText(/Ещё уведомлений/)).toBeNull();
    act(() => api.clear());
    expect(screen.queryByText('Первое')).toBeNull();
  });

  it('does nothing outside a provider instead of throwing', () => {
    function Alone() {
      const toast = useToast();
      return <button onClick={() => toast.show({ message: 'x' })}>go</button>;
    }
    render(<Alone />);
    expect(() => fireEvent.click(screen.getByText('go'))).not.toThrow();
  });
});
