import { create } from 'zustand';
import type { LockKind, Settings } from '../../domain/types';
import {
  CryptoError,
  checkPassword,
  createPasswordVerifier,
  getSettings,
  getStoredSettings,
  setSessionSecrets,
  updateSettings,
  wipeAll,
} from '../../db';
import type { SessionSecrets } from '../../db';
import { EMPTY_SECRETS, collectSecrets, openSecrets, sealSecrets } from './secrets';
import { t } from '../../i18n';

/**
 * The app lock (docs/SPEC.md §7). What it protects, honestly: the way into the app (the lock screen at launch and
 * after inactivity) and the API keys, which are stored encrypted with the password (see `secrets.ts`). The records
 * in IndexedDB are not encrypted: anyone with the unlocked browser profile can read them. A sealed copy for moving
 * data between devices is the encrypted backup.
 *
 * State machine of `useLockStore().status`:
 *   checking → off                       (no lock)
 *   checking → locked → unlocked         (lock on at launch, password entered)
 *   unlocked → locked                    (inactivity, "Заблокировать сейчас")
 * The password is kept in memory while unlocked, only to re-seal the keys when the user changes one.
 */

export type LockStatus = 'checking' | 'off' | 'locked' | 'unlocked';

interface LockState {
  status: LockStatus;
  /** Wrong attempts in a row since the last success. */
  failures: number;
  /** `Date.now()` before which no attempt is accepted (a delay that grows with the failures). */
  blockedUntil: number;
}

export const useLockStore = create<LockState>(() => ({ status: 'checking', failures: 0, blockedUntil: 0 }));

let sessionPassword: string | null = null;

// The delay after wrong attempts survives a reload: otherwise «Обновить страницу» gives two free guesses again.
const THROTTLE_KEY = 'orbit.lock.throttle';
function loadThrottle(): { failures: number; blockedUntil: number } {
  try {
    const raw = JSON.parse(localStorage.getItem(THROTTLE_KEY) ?? 'null') as { failures?: unknown; blockedUntil?: unknown } | null;
    const failures = typeof raw?.failures === 'number' && raw.failures > 0 ? Math.floor(raw.failures) : 0;
    const blockedUntil = typeof raw?.blockedUntil === 'number' && raw.blockedUntil > 0 ? raw.blockedUntil : 0;
    return { failures, blockedUntil };
  } catch {
    return { failures: 0, blockedUntil: 0 };
  }
}
function saveThrottle(failures: number, blockedUntil: number): void {
  try {
    if (failures === 0) localStorage.removeItem(THROTTLE_KEY);
    else localStorage.setItem(THROTTLE_KEY, JSON.stringify({ failures, blockedUntil }));
  } catch {
    // Private mode or blocked storage: the in-memory delay still applies.
  }
}

/** Work factor for new locks; tests lower it. */
let iterations: number | undefined;
export function setLockIterations(value: number | undefined): void {
  iterations = value;
}
const sealOptions = (): { iterations?: number } | undefined => (iterations === undefined ? undefined : { iterations });

export const MIN_PASSWORD_LENGTH = 6;
export const MIN_PIN_LENGTH = 4;
export const AUTO_LOCK_CHOICES = [0, 1, 5, 15, 60] as const;

/** Seconds to wait after the n-th wrong attempt in a row: free for two, then 2, 4, 8 … up to 60. */
export function throttleSeconds(failures: number): number {
  if (failures <= 2) return 0;
  return Math.min(60, 2 ** (failures - 2));
}

/** `null` when the new password is acceptable, otherwise what to tell the user. */
export function validateNewPassword(kind: LockKind, password: string, repeat: string): string | null {
  if (kind === 'pin') {
    if (!/^\d+$/.test(password)) return t('A PIN consists of digits only.');
    if (password.length < MIN_PIN_LENGTH) return t('The PIN is shorter than {MIN_PIN_LENGTH} digits.', { MIN_PIN_LENGTH });
  } else if (password.length < MIN_PASSWORD_LENGTH) {
    return t('The password is shorter than {MIN_PASSWORD_LENGTH} characters.', { MIN_PASSWORD_LENGTH });
  }
  if (password !== repeat) return t('The repeat does not match.');
  return null;
}

// ───────── status ─────────

/** Reads the stored settings and sets `off` or `locked`. Call once at launch, and after an import. */
export async function initLock(): Promise<LockStatus> {
  const stored = await getStoredSettings();
  setSessionSecrets(null);
  sessionPassword = null;
  const status: LockStatus = stored.lock.enabled ? 'locked' : 'off';
  useLockStore.setState({ status, ...(status === 'locked' ? loadThrottle() : { failures: 0, blockedUntil: 0 }) });
  return status;
}

/** Locks at once: forgets the password and the plain keys. */
export function lockNow(): void {
  if (useLockStore.getState().status !== 'unlocked') return;
  sessionPassword = null;
  setSessionSecrets(null);
  useLockStore.setState({ status: 'locked', failures: 0, blockedUntil: 0 });
}

export type UnlockResult = 'ok' | 'wrong' | 'wait';

/** Checks the password; on success the keys are decrypted into memory and the app opens. */
export async function unlock(password: string, now: number = Date.now()): Promise<UnlockResult> {
  const { blockedUntil, failures } = useLockStore.getState();
  if (now < blockedUntil) return 'wait';
  const { lock } = await getStoredSettings();
  const correct = lock.enabled && (await checkPassword(password, lock));
  if (!correct) {
    const next = failures + 1;
    const blockedUntil = now + throttleSeconds(next) * 1000;
    useLockStore.setState({ failures: next, blockedUntil });
    saveThrottle(next, blockedUntil);
    return 'wrong';
  }
  let secrets = EMPTY_SECRETS;
  if (lock.sealedSecrets) {
    try {
      secrets = await openSecrets(password, lock.sealedSecrets);
    } catch (error) {
      if (!(error instanceof CryptoError)) throw error;
      // Verified password but unreadable keys: open the app, the user enters the keys again.
      console.error(t('Could not decrypt the API keys'), error);
    }
  }
  sessionPassword = password;
  setSessionSecrets(secrets);
  useLockStore.setState({ status: 'unlocked', failures: 0, blockedUntil: 0 });
  saveThrottle(0, 0);
  return 'ok';
}

/** Seconds left of the delay after wrong attempts (0 when free). */
export function secondsUntilRetry(now: number = Date.now()): number {
  return Math.max(0, Math.ceil((useLockStore.getState().blockedUntil - now) / 1000));
}

// ───────── set up, change, turn off ─────────

export class LockError extends Error {
  constructor(
    readonly code: 'wrong_password' | 'not_unlocked' | 'not_enabled' | 'invalid',
    message: string,
  ) {
    super(message);
    this.name = 'LockError';
  }
}

async function verifiedLock(password: string): Promise<Settings['lock']> {
  const { lock } = await getStoredSettings();
  if (!lock.enabled) throw new LockError('not_enabled', t('Lock is not enabled.'));
  if (!(await checkPassword(password, lock))) throw new LockError('wrong_password', t('Wrong password.'));
  return lock;
}

export interface EnableLockOptions {
  kind: LockKind;
  autoLockMinutes: number;
}

/** Turns the lock on: the keys move from the settings into the sealed blob, and the app stays unlocked. */
export async function enableLock(password: string, { kind, autoLockMinutes }: EnableLockOptions): Promise<void> {
  const problem = validateNewPassword(kind, password, password);
  if (problem) throw new LockError('invalid', problem);
  const secrets = collectSecrets(await getSettings());
  const verifier = await createPasswordVerifier(password, sealOptions());
  const sealedSecrets = await sealSecrets(password, secrets, sealOptions());
  await updateSettings({ lock: { enabled: true, kind, autoLockMinutes, ...verifier, sealedSecrets } });
  sessionPassword = password;
  setSessionSecrets(secrets);
  useLockStore.setState({ status: 'unlocked', failures: 0, blockedUntil: 0 });
}

/** Turns the lock off: the keys go back into the settings in the clear. */
export async function disableLock(password: string): Promise<void> {
  await verifiedLock(password);
  const secrets = await currentSecrets(password);
  await updateSettings({
    lock: { enabled: false, salt: '', iterations: 0, verifier: '', sealedSecrets: null },
    ai: { anthropic: { apiKey: secrets.anthropic }, openaiCompat: { apiKey: secrets.openaiCompat } },
    stt: { apiKey: secrets.stt },
  });
  sessionPassword = null;
  setSessionSecrets(null);
  useLockStore.setState({ status: 'off', failures: 0, blockedUntil: 0 });
}

export async function changePassword(oldPassword: string, newPassword: string, kind: LockKind): Promise<void> {
  await verifiedLock(oldPassword);
  const problem = validateNewPassword(kind, newPassword, newPassword);
  if (problem) throw new LockError('invalid', problem);
  const secrets = await currentSecrets(oldPassword);
  const verifier = await createPasswordVerifier(newPassword, sealOptions());
  const sealedSecrets = await sealSecrets(newPassword, secrets, sealOptions());
  await updateSettings({ lock: { kind, ...verifier, sealedSecrets } });
  sessionPassword = newPassword;
  setSessionSecrets(secrets);
}

/** Keys from memory when unlocked, else from the sealed blob. */
async function currentSecrets(password: string): Promise<SessionSecrets> {
  const { lock } = await getStoredSettings();
  return lock.sealedSecrets ? openSecrets(password, lock.sealedSecrets) : EMPTY_SECRETS;
}

export async function setAutoLockMinutes(minutes: number): Promise<void> {
  await updateSettings({ lock: { autoLockMinutes: minutes } });
}

// ───────── API keys ─────────

/**
 * Saves API keys. Lock off: plain fields of the settings. Lock on: the sealed blob is made anew with the password
 * kept in memory, the plain fields stay empty. A key that is not in `keys` stays as it was.
 */
export async function saveApiKeys(keys: Partial<SessionSecrets>): Promise<void> {
  const stored = await getStoredSettings();
  if (!stored.lock.enabled) {
    await updateSettings({
      ai: {
        anthropic: { apiKey: keys.anthropic?.trim() },
        openaiCompat: { apiKey: keys.openaiCompat?.trim() },
      },
      stt: { apiKey: keys.stt?.trim() },
    });
    return;
  }
  if (sessionPassword === null) throw new LockError('not_unlocked', t('Unlock the app first.'));
  const base = collectSecrets(await getSettings());
  const next: SessionSecrets = {
    anthropic: (keys.anthropic ?? base.anthropic).trim(),
    openaiCompat: (keys.openaiCompat ?? base.openaiCompat).trim(),
    stt: (keys.stt ?? base.stt).trim(),
  };
  const sealedSecrets = await sealSecrets(sessionPassword, next, sealOptions());
  await updateSettings({ lock: { sealedSecrets } });
  setSessionSecrets(next);
}

/** "Forgot the password": there is no recovery, the only way out is to erase the data. */
export async function eraseEverythingAndUnlock(): Promise<void> {
  await wipeAll();
  sessionPassword = null;
  setSessionSecrets(null);
  useLockStore.setState({ status: 'off', failures: 0, blockedUntil: 0 });
}
