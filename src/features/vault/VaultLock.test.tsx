import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../i18n';
import { useVaultState } from '../../vault/state';

type Result = 'ok' | 'wrong' | 'wait' | 'tab' | 'error';
const runtime = vi.hoisted(() => ({
  unlock: vi.fn<(c: unknown) => Promise<Result>>(),
  header: vi.fn(() => ({ v: 1, app: 'orbita', createdAt: 1, wraps: [{ kind: 'passkey', credentialId: 'cred', iv: '', data: '', createdAt: 1 }] })),
  secondsUntilRetry: vi.fn(() => 7),
  eraseEverything: vi.fn(async () => undefined),
  boot: vi.fn(async () => {
    (await import('../../vault/state')).useVaultState.setState({ state: 'locked' });
  }),
}));
vi.mock('../../vault', async () => ({ ...(await vi.importActual<object>('../../vault/state')), vault: runtime }));
const backend = vi.hoisted(() => ({ journalExists: vi.fn(async (_name: string): Promise<boolean | null> => true), selectNativeBackend: vi.fn() }));
vi.mock('../../vault/backend', async () => ({ ...(await vi.importActual<object>('../../vault/backend')), ...backend }));
vi.mock('../../vault/passkey', () => ({
  passkeySupported: () => true,
  PasskeyError: class PasskeyError extends Error {
    constructor(public code: string) {
      super(code);
    }
  },
  askVaultPasskey: vi.fn(async () => ({ credentialId: 'cred', secret: new Uint8Array(32) })),
}));

import { VaultGate } from './VaultGate';
import VaultLock from './VaultLock';

beforeEach(() => {
  vi.clearAllMocks();
  runtime.secondsUntilRetry.mockReturnValue(7);
  useVaultState.setState({ state: 'locked', busy: false });
});

describe('the lock screen', () => {
  it('offers the password first, and does nothing until something is typed', async () => {
    render(<VaultLock />);
    expect(await screen.findByText(t('Orbita is locked'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('Open', undefined, 'lock-screen') })).toBeDisabled();
    expect(runtime.unlock).not.toHaveBeenCalled();
  });

  it('sends the password, and explains each way it can fail in plain words', async () => {
    const user = userEvent.setup();
    runtime.secondsUntilRetry.mockReturnValue(0); // no waiting between these tries
    render(<VaultLock />);
    const input = await screen.findByLabelText(t('Password'));
    for (const [result, message] of [
      ['wrong', t('Wrong password.')],
      ['wait', t('Too many attempts.')],
      ['tab', t('Orbita is open in another window. Close it and try again.')],
      ['error', t('The data could not be opened.')],
    ] as const) {
      runtime.unlock.mockResolvedValueOnce(result);
      await user.clear(input);
      await user.type(input, 'пароль-для-проверки');
      await user.click(screen.getByRole('button', { name: t('Open', undefined, 'lock-screen') }));
      await waitFor(() => expect(screen.getByText(message)).toBeInTheDocument());
    }
    expect(runtime.unlock).toHaveBeenLastCalledWith({ kind: 'password', password: 'пароль-для-проверки' });
  });

  it('a wrong answer empties the field and shows how long to wait before the next try', async () => {
    const user = userEvent.setup();
    render(<VaultLock />);
    runtime.unlock.mockResolvedValueOnce('wrong');
    const input = await screen.findByLabelText(t('Password'));
    await user.type(input, 'не тот');
    await user.click(screen.getByRole('button', { name: t('Open', undefined, 'lock-screen') }));
    expect(await screen.findByText(t('Wait {wait} s and try again.', { wait: 7 }))).toBeInTheDocument();
    expect(input).toHaveValue('');
    expect(screen.getByRole('button', { name: t('Open', undefined, 'lock-screen') })).toBeDisabled();
  });

  it('switches to the recovery key and sends it as one', async () => {
    const user = userEvent.setup();
    render(<VaultLock />);
    await user.click(await screen.findByRole('button', { name: t('I forgot the password') }));
    runtime.unlock.mockResolvedValueOnce('wrong');
    await user.type(screen.getByLabelText(t('Recovery key')), 'AAAAA-BBBBB');
    await user.click(screen.getByRole('button', { name: t('Open', undefined, 'lock-screen') }));
    expect(await screen.findByText(t('That recovery key does not match.'))).toBeInTheDocument();
    expect(runtime.unlock).toHaveBeenCalledWith({ kind: 'recovery', key: 'AAAAA-BBBBB' });
    await user.click(screen.getByRole('button', { name: t('Use the password instead') }));
    expect(screen.getByLabelText(t('Password'))).toHaveValue('');
  });

  it('opens with a passkey, and says so when it did not work; a cancelled prompt says nothing', async () => {
    const user = userEvent.setup();
    render(<VaultLock />);
    runtime.unlock.mockResolvedValueOnce('ok');
    await user.click(await screen.findByRole('button', { name: t('Use a passkey') }));
    await waitFor(() => expect(runtime.unlock).toHaveBeenCalledWith({ kind: 'passkey', credentialId: 'cred', secret: expect.any(Uint8Array) }));

    const { askVaultPasskey, PasskeyError } = await import('../../vault/passkey');
    vi.mocked(askVaultPasskey).mockRejectedValueOnce(new PasskeyError('cancelled' as never));
    await user.click(screen.getByRole('button', { name: t('Use a passkey') }));
    expect(screen.queryByText(t('The passkey did not work.'))).toBeNull();

    vi.mocked(askVaultPasskey).mockRejectedValueOnce(new Error('no'));
    await user.click(screen.getByRole('button', { name: t('Use a passkey') }));
    expect(await screen.findByText(t('The passkey did not work.'))).toBeInTheDocument();
  });

  it('erasing everything asks first, wants the word typed, and can be cancelled', async () => {
    const user = userEvent.setup();
    render(<VaultLock />);
    await user.click(await screen.findByRole('button', { name: t('I lost everything: start over') }));
    await user.click(screen.getByRole('button', { name: t('Cancel', undefined, 'typed-confirm') }));
    expect(runtime.eraseEverything).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: t('I lost everything: start over') }));
    const erase = screen.getByRole('button', { name: t('Erase everything') });
    expect(erase).toBeDisabled();
    await user.type(screen.getByLabelText(t('To confirm, type “{word}”', { word: t('delete') })), t('delete'));
    await user.click(erase);
    expect(runtime.eraseEverything).toHaveBeenCalledTimes(1);
  });
});

describe('the gate in front of the app', () => {
  const app = (ready: () => void) => (
    <VaultGate onReady={ready}>
      <p>приложение</p>
    </VaultGate>
  );

  it('with encryption on, boots the vault, shows the lock, and shows the app (announcing it once) when open', async () => {
    useVaultState.setState({ state: 'checking' });
    const ready = vi.fn();
    render(app(ready));
    expect(await screen.findByText(t('Orbita is locked'))).toBeInTheDocument();
    expect(runtime.boot).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('приложение')).toBeNull();
    expect(ready).not.toHaveBeenCalled();
    act(() => useVaultState.setState({ state: 'unlocked' }));
    expect(await screen.findByText('приложение')).toBeInTheDocument();
    expect(ready).toHaveBeenCalledTimes(1);
  });

  it('with encryption off, steps aside at once and never loads the vault', async () => {
    backend.journalExists.mockResolvedValueOnce(false);
    useVaultState.setState({ state: 'checking' });
    const ready = vi.fn();
    render(app(ready));
    expect(await screen.findByText('приложение')).toBeInTheDocument();
    expect(runtime.boot).not.toHaveBeenCalled();
    expect(backend.selectNativeBackend).toHaveBeenCalledTimes(1);
    expect(ready).toHaveBeenCalledTimes(1);
  });

  it('when the browser cannot say, the hint left by the vault decides', async () => {
    backend.journalExists.mockResolvedValueOnce(null);
    localStorage.setItem('orbita.vault', '1');
    useVaultState.setState({ state: 'checking' });
    render(app(vi.fn()));
    expect(await screen.findByText(t('Orbita is locked'))).toBeInTheDocument();
    localStorage.removeItem('orbita.vault');
  });
});
