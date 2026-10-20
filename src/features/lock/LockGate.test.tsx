import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PBKDF2_MIN_ITERATIONS } from '../../domain/schemas';
import { setSessionSecrets, wipeAll } from '../../db';
import { ThemeProvider } from '../../styles/theme';
import { ToastProvider } from '../../ui';
import { stubCanvas } from '../../ui/testUtils';
import { LockGate } from './LockGate';
import { enableLock, initLock, setLockIterations, useLockStore } from './lockService';

const PASSWORD = 'орбита-2026';

function renderGate() {
  return render(
    <ThemeProvider>
      <ToastProvider>
        <LockGate>
          <p>Содержимое приложения</p>
        </LockGate>
      </ToastProvider>
    </ThemeProvider>,
  );
}

beforeEach(async () => {
  stubCanvas();
  setLockIterations(PBKDF2_MIN_ITERATIONS);
  await wipeAll();
  setSessionSecrets(null);
  useLockStore.setState({ status: 'checking', failures: 0, blockedUntil: 0 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('LockGate', () => {
  it('opens straight away when there is no lock', async () => {
    renderGate();
    expect(await screen.findByText('Содержимое приложения')).toBeInTheDocument();
  });

  it('asks for the password at launch; a wrong one is refused, the right one opens the app', async () => {
    await enableLock(PASSWORD, { kind: 'password', autoLockMinutes: 5 });
    await initLock(); // a new launch

    renderGate();
    expect(await screen.findByRole('heading', { name: 'Орбита закрыта' })).toBeInTheDocument();
    expect(screen.queryByText('Содержимое приложения')).not.toBeInTheDocument();

    const field = screen.getByLabelText('Пароль');
    fireEvent.change(field, { target: { value: 'не тот пароль' } });
    fireEvent.click(screen.getByRole('button', { name: 'Открыть' }));
    expect(await screen.findByText('Неверный пароль.')).toBeInTheDocument();
    expect(screen.queryByText('Содержимое приложения')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: PASSWORD } });
    fireEvent.click(screen.getByRole('button', { name: 'Открыть' }));
    expect(await screen.findByText('Содержимое приложения')).toBeInTheDocument();
  });

  it('locks again after the inactivity time', async () => {
    await enableLock(PASSWORD, { kind: 'password', autoLockMinutes: 1 });
    renderGate();
    expect(await screen.findByText('Содержимое приложения')).toBeInTheDocument();
    // The minutes are read from the stored settings after the first render.
    await waitFor(() => expect(useLockStore.getState().status).toBe('unlocked'));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    vi.useFakeTimers();
    // The timer is armed by the effect that already ran; re-render to arm it under fake timers.
    act(() => {
      window.dispatchEvent(new Event('pointerdown'));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    vi.useRealTimers();
    expect(await screen.findByRole('heading', { name: 'Орбита закрыта' })).toBeInTheDocument();
  });
});
