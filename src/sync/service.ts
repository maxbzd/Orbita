import Dexie from 'dexie';
import type { SupabaseClient } from '@supabase/supabase-js';
import { create } from 'zustand';
import { AccountMismatchError, adoptAccount, forgetCloud, runSync } from './engine';
import type { SyncBackend, SyncReport } from './engine';
import { SUPABASE_KEY, SUPABASE_URL, syncEnabled } from './config';
import { createSupabaseBackend, deleteCloudData } from './supabaseBackend';
import { t } from '../i18n';

/**
 * Cloud sync: the account, the schedule and the state the screens show. The records themselves move in
 * `engine.ts`; this file decides when. The Supabase library is loaded only when there is, or is about to be,
 * an account, so a device that never signs in does not pay for it.
 */

export type CloudStatus = 'starting' | 'signed-out' | 'idle' | 'syncing' | 'offline' | 'error' | 'account-conflict';

export interface CloudState {
  status: CloudStatus;
  email: string | null;
  userId: string | null;
  /** `Date.now()` of the last round that finished. */
  lastSyncAt: number | null;
  lastReport: SyncReport | null;
  error: string | null;
  /** A recovery link was opened: the next thing to ask for is a new password. */
  needsNewPassword: boolean;
}

export const useCloud = create<CloudState>(() => ({
  status: 'starting',
  email: null,
  userId: null,
  lastSyncAt: null,
  lastReport: null,
  error: null,
  needsNewPassword: false,
}));

const set = (patch: Partial<CloudState>): void => useCloud.setState(patch);

const timings = { poll: 60_000, debounce: 2_500, realtime: 800, retryFirst: 20_000, retryMax: 5 * 60_000 };
/** Tests shorten the waits. */
export function setCloudTimings(patch: Partial<typeof timings>): void {
  Object.assign(timings, patch);
}
const LOCK_NAME = 'orbita-cloud-sync';

let client: SupabaseClient | undefined;
let backend: SyncBackend | undefined;
let started = false;
let dirty = true;
let running: Promise<void> | undefined;
let rerun = false;
let debounce: number | undefined;
let retry: number | undefined;
let retryDelay = 0;
let channelCleanup: (() => void) | undefined;

// ───────── Errors in the user's words ─────────

export function describeCloudError(error: unknown): string {
  const text =
    error instanceof Error
      ? error.message
      : typeof (error as { message?: unknown } | null)?.message === 'string'
        ? ((error as { message: string }).message)
        : String(error ?? '');
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(text)) return t('No connection to the cloud.');
  if (/invalid login credentials/i.test(text)) return t('Wrong email or password.');
  if (/email not confirmed/i.test(text)) return t('Email not confirmed: open the message and click the link.');
  if (/already registered|already been registered/i.test(text)) return t('This email is already registered: sign in.');
  if (/at least \d+ characters|weak password/i.test(text)) return t('The password is too short: at least 6 characters are needed.');
  if (/rate limit|too many requests|over_email_send_rate_limit/i.test(text)) return t('Too many attempts. Wait a minute and try again.');
  if (/valid email|invalid email|unable to validate email/i.test(text)) return t('Check the email address.');
  if (/same password/i.test(text)) return t('The new password must differ from the old one.');
  return text || t('That did not work. Try again.');
}

const isOffline = (error: unknown): boolean =>
  (typeof navigator !== 'undefined' && navigator.onLine === false) || /failed to fetch|networkerror|load failed|network request failed/i.test(error instanceof Error ? error.message : String(error));

// ───────── Client ─────────

async function getClient(): Promise<SupabaseClient> {
  if (client) return client;
  const { createClient } = await import('@supabase/supabase-js');
  client = createClient(SUPABASE_URL, SUPABASE_KEY, {
    // The router lives in the hash: links with tokens are read by hand (see `consumeAuthLink`).
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  client.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      stopAuto();
      backend = undefined;
      set({ status: 'signed-out', email: null, userId: null, error: null });
    } else if (session && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED')) {
      if (backend?.userId !== session.user.id) {
        backend = createSupabaseBackend(client as SupabaseClient, session.user.id);
        set({ userId: session.user.id, email: session.user.email ?? null, status: 'idle', error: null });
        startAuto(session.user.id);
      }
    } else if (event === 'PASSWORD_RECOVERY') {
      set({ needsNewPassword: true });
    }
  });
  return client;
}

/** Whether the browser holds a saved session (cheap check, before the library is loaded). */
function hasSavedSession(): boolean {
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key && /^sb-.*-auth-token$/.test(key)) return true;
    }
  } catch {
    // storage blocked: no saved session
  }
  return false;
}

/** A confirmation or recovery link brings `#access_token=…&refresh_token=…&type=…`: sign in with it. */
async function consumeAuthLink(): Promise<boolean> {
  const hash = window.location.hash;
  if (!/access_token=/.test(hash) || !/refresh_token=/.test(hash)) return false;
  const params = new URLSearchParams(hash.replace(/^#\/?/, ''));
  const access = params.get('access_token');
  const refresh = params.get('refresh_token');
  const type = params.get('type');
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/settings?section=cloud`);
  if (!access || !refresh) return false;
  const { error } = await (await getClient()).auth.setSession({ access_token: access, refresh_token: refresh });
  if (error) {
    set({ error: describeCloudError(error) });
    return false;
  }
  if (type === 'recovery') set({ needsNewPassword: true });
  return true;
}

// ───────── Rounds ─────────

/** Whether the mutation touched anything but the sync bookkeeping. */
function touchesData(parts: Record<string, unknown>): boolean {
  return Object.keys(parts).some((key) => !key.includes('/syncmeta/') && !key.includes('/settings/') && !key.includes('/chunks/'));
}

async function round(push: boolean): Promise<void> {
  if (!backend) return;
  set({ status: 'syncing', error: null });
  const wantPush = push || dirty;
  dirty = false;
  try {
    const report = await runSync(backend, { push: wantPush });
    retryDelay = 0;
    set({ status: 'idle', lastSyncAt: Date.now(), lastReport: report, error: null });
  } catch (error) {
    dirty = dirty || wantPush;
    if (error instanceof AccountMismatchError) {
      set({ status: 'account-conflict', error: null });
      return;
    }
    set({ status: isOffline(error) ? 'offline' : 'error', error: isOffline(error) ? null : describeCloudError(error) });
    scheduleRetry();
  }
}

function scheduleRetry(): void {
  window.clearTimeout(retry);
  const delay = retryDelay || timings.retryFirst;
  retry = window.setTimeout(() => void syncNow(), delay);
  retryDelay = Math.min(timings.retryMax, delay * 2);
}

/** One round now (or right after the one running). Several tabs never run at once. */
export function syncNow({ push = false }: { push?: boolean } = {}): Promise<void> {
  if (!backend || useCloud.getState().status === 'account-conflict') return Promise.resolve();
  if (push) dirty = true;
  if (running) {
    rerun = true;
    return running;
  }
  const run = async (): Promise<void> => {
    // At most a few rounds in a row: what this device writes while merging must not keep it busy for ever.
    for (let rounds = 0; rounds < 4; rounds += 1) {
      rerun = false;
      let ran = true;
      const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
      if (locks) {
        await locks.request(LOCK_NAME, { ifAvailable: true }, async (lock) => {
          if (lock) await round(false);
          else ran = false; // another tab is syncing: it does the work
        });
      } else await round(false);
      if (!ran || !(rerun || (dirty && useCloud.getState().status === 'idle'))) break;
    }
  };
  running = run().finally(() => {
    running = undefined;
  });
  return running;
}

// ───────── Automatic sync ─────────

let stopListeners: (() => void) | undefined;

function startAuto(userId: string): void {
  stopAuto();
  dirty = true;
  const wake = (): void => {
    if (document.visibilityState === 'visible') void syncNow();
  };
  const onMutated = (parts: Record<string, unknown>): void => {
    if (!touchesData(parts)) return;
    dirty = true;
    window.clearTimeout(debounce);
    debounce = window.setTimeout(() => void syncNow(), timings.debounce);
  };
  Dexie.on('storagemutated', onMutated as never);
  window.addEventListener('online', wake);
  document.addEventListener('visibilitychange', wake);
  const poll = window.setInterval(wake, timings.poll);
  stopListeners = () => {
    Dexie.on('storagemutated').unsubscribe(onMutated as never);
    window.removeEventListener('online', wake);
    document.removeEventListener('visibilitychange', wake);
    window.clearInterval(poll);
  };

  // Other devices: the server tells us at once.
  const live = client
    ?.channel(`orbita-sync-${userId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sync_rows', filter: `user_id=eq.${userId}` }, () => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(() => void syncNow(), timings.realtime);
    })
    .subscribe();
  channelCleanup = () => {
    if (live) void client?.removeChannel(live);
  };
  void syncNow({ push: true });
}

function stopAuto(): void {
  stopListeners?.();
  stopListeners = undefined;
  channelCleanup?.();
  channelCleanup = undefined;
  window.clearTimeout(debounce);
  window.clearTimeout(retry);
}

// ───────── Public API ─────────

/** Call once at launch. Does nothing without a saved session or a sign-in link. */
export async function startCloud(): Promise<void> {
  if (started) return;
  started = true;
  if (!syncEnabled()) return;
  if (!hasSavedSession() && !/access_token=/.test(window.location.hash)) {
    set({ status: 'signed-out' });
    return;
  }
  try {
    await getClient();
    await consumeAuthLink();
    const { data } = await (client as SupabaseClient).auth.getSession();
    if (!data.session) set({ status: 'signed-out' });
  } catch (error) {
    set({ status: isOffline(error) ? 'offline' : 'error', error: isOffline(error) ? null : describeCloudError(error) });
  }
}

export type SignUpResult = 'signed-in' | 'confirm-email';

export async function signUp(email: string, password: string): Promise<SignUpResult> {
  const supabase = await getClient();
  const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: `${window.location.origin}${window.location.pathname}` } });
  if (error) throw new Error(describeCloudError(error));
  // An address that is already registered answers with no identities (and no error) to hide it.
  if (data.user && (data.user.identities?.length ?? 1) === 0) throw new Error(describeCloudError('already registered'));
  return data.session ? 'signed-in' : 'confirm-email';
}

export async function signIn(email: string, password: string): Promise<void> {
  const supabase = await getClient();
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error(describeCloudError(error));
}

export async function sendPasswordReset(email: string): Promise<void> {
  const supabase = await getClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}${window.location.pathname}` });
  if (error) throw new Error(describeCloudError(error));
}

export async function setNewPassword(password: string): Promise<void> {
  const supabase = await getClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw new Error(describeCloudError(error));
  set({ needsNewPassword: false });
}

/** Signs out. The data stays on this device; the next sign-in treats it as new. */
export async function signOut(): Promise<void> {
  const supabase = await getClient();
  await supabase.auth.signOut();
  await forgetCloud();
  set({ lastSyncAt: null, lastReport: null });
}

/** The device holds another account's data: keep it and share it with this account (`merge`), or clear it first (`replace`). */
export async function resolveAccountConflict(mode: 'merge' | 'replace'): Promise<void> {
  if (!backend) return;
  await adoptAccount(backend, mode);
  set({ status: 'idle' });
  await syncNow({ push: true });
}

/** Deletes everything of this account in the cloud (records and recordings) and signs out. Local data stays. */
export async function wipeCloud(): Promise<void> {
  if (!client || !backend) throw new Error(t('Sign in to the cloud.'));
  await deleteCloudData(client, backend.userId);
  await signOut();
}

/** For tests: forget the module state. */
export function resetCloudForTests(): void {
  stopAuto();
  backend = undefined;
  client = undefined;
  started = false;
  running = undefined;
  rerun = false;
  dirty = true;
  retryDelay = 0;
  useCloud.setState({ status: 'starting', email: null, userId: null, lastSyncAt: null, lastReport: null, error: null, needsNewPassword: false });
}
