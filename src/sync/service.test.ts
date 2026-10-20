import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { capturesRepo, db, wipeAll } from '../db';
import { FakeCloud } from './testing';

// A stand-in for supabase-js backed by the in-memory cloud: same shapes, same answers.
const fake = vi.hoisted(() => ({
  cloud: undefined as unknown as import('./testing').FakeCloud,
  userId: 'u1',
  authListener: undefined as ((event: string, session: unknown) => void) | undefined,
  realtime: undefined as (() => void) | undefined,
  session: null as unknown,
  channelsRemoved: 0,
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => {
    const backend = () => fake.cloud.backend(fake.userId);
    const signedIn = (email: string) => {
      fake.session = { user: { id: fake.userId, email } };
      fake.authListener?.('SIGNED_IN', fake.session);
      return fake.session;
    };
    return {
      auth: {
        onAuthStateChange: (listener: (event: string, session: unknown) => void) => {
          fake.authListener = listener;
          return { data: { subscription: { unsubscribe: () => undefined } } };
        },
        signInWithPassword: async ({ email, password }: { email: string; password: string }) =>
          password === 'good-password' ? { data: { session: signedIn(email) }, error: null } : { data: {}, error: { message: 'Invalid login credentials' } },
        signUp: async ({ email }: { email: string }) => ({ data: { session: null, user: { identities: [{}], email } }, error: null }),
        getSession: async () => ({ data: { session: fake.session } }),
        signOut: async () => {
          fake.session = null;
          fake.authListener?.('SIGNED_OUT', null);
          return { error: null };
        },
        resetPasswordForEmail: async () => ({ error: null }),
        updateUser: async () => ({ error: null }),
        setSession: async () => ({ error: null }),
      },
      from: () => ({
        upsert: async (rows: { tbl: never; id: string; data: unknown }[]) => {
          await backend().upsert(rows);
          return { error: null };
        },
        select: () => {
          let since: string | null = null;
          const chain = {
            eq: () => chain,
            gte: (_column: string, value: string) => {
              since = value;
              return chain;
            },
            order: () => chain,
            limit: async (count: number) => ({ data: await backend().pull(since, count), error: null }),
          };
          return chain;
        },
        delete: () => ({
          eq: async () => {
            for (const key of [...fake.cloud.rows.keys()]) if (key.startsWith(`${fake.userId}/`)) fake.cloud.rows.delete(key);
            return { error: null };
          },
        }),
      }),
      storage: {
        from: () => ({
          upload: async (path: string, blob: Blob) => {
            await backend().uploadAudio(path.split('/')[1] as string, blob);
            return { error: null };
          },
          download: async (path: string) => {
            const blob = await backend().downloadAudio(path.split('/')[1] as string);
            return blob ? { data: blob, error: null } : { data: null, error: { message: 'not found' } };
          },
          list: async () => ({ data: [...(await backend().listAudio())].map((name) => ({ name })), error: null }),
          remove: async (paths: string[]) => {
            await backend().removeAudio(paths.map((path) => path.split('/')[1] as string));
            return { error: null };
          },
        }),
      },
      channel: () => {
        const channel = {
          on: (_type: string, _filter: unknown, callback: () => void) => {
            fake.realtime = callback;
            return channel;
          },
          subscribe: () => channel,
        };
        return channel;
      },
      removeChannel: async () => {
        fake.channelsRemoved += 1;
      },
    };
  },
}));

import { resetCloudForTests, resolveAccountConflict, setCloudTimings, signIn, signOut, signUp, startCloud, syncNow, useCloud, wipeCloud } from './service';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits until a round has had time to start and finish. */
const settle = async (ms = 0): Promise<void> => {
  await sleep(ms);
  await vi.waitFor(() => expect(useCloud.getState().status).not.toBe('syncing'), { timeout: 4000 });
};

beforeEach(async () => {
  setCloudTimings({ poll: 1e9, debounce: 40, realtime: 20, retryFirst: 80, retryMax: 200 });
  localStorage.clear();
  await wipeAll();
  fake.cloud = new FakeCloud();
  fake.userId = 'u1';
  fake.session = null;
  fake.realtime = undefined;
  fake.channelsRemoved = 0;
  resetCloudForTests();
});

afterEach(() => {
  resetCloudForTests();
});

describe('signing in', () => {
  it('without an account nothing is loaded or sent', async () => {
    await startCloud();
    expect(useCloud.getState().status).toBe('signed-out');
  });

  it('a wrong password says so in plain words and stays signed out', async () => {
    await expect(signIn('max@example.com', 'bad')).rejects.toThrow('Неверная почта или пароль.');
    expect(useCloud.getState().userId).toBeNull();
  });

  it('signing in sends what is on the device and shows the result', async () => {
    await capturesRepo.create({ kind: 'text', text: 'уже было', status: 'done' });
    await signIn('max@example.com', 'good-password');
    await settle();
    const state = useCloud.getState();
    expect(state).toMatchObject({ status: 'idle', email: 'max@example.com', userId: 'u1' });
    expect(state.lastSyncAt).not.toBeNull();
    expect(fake.cloud.table('captures')).toHaveLength(1);
  });

  it('a sign-up that needs a confirmed mail does not pretend to be signed in', async () => {
    expect(await signUp('new@example.com', 'good-password')).toBe('confirm-email');
    expect(useCloud.getState().userId).toBeNull();
  });
});

describe('keeping in step', () => {
  beforeEach(async () => {
    await signIn('max@example.com', 'good-password');
    await settle();
  });

  it('a change made on the device goes up a moment later, once', async () => {
    await capturesRepo.create({ kind: 'text', text: 'новая мысль', status: 'done' });
    expect(fake.cloud.table('captures')).toHaveLength(0);
    await settle(150);
    expect(fake.cloud.table('captures')).toHaveLength(1);
    const upserts = fake.cloud.calls.upsert;
    await settle(300);
    expect(fake.cloud.calls.upsert).toBe(upserts); // nothing left to send, no loop
  });

  it('several quick changes make one round', async () => {
    for (let index = 0; index < 5; index += 1) await capturesRepo.create({ kind: 'text', text: `мысль ${index}`, status: 'done' });
    await settle(150);
    expect(fake.cloud.table('captures')).toHaveLength(5);
    expect(fake.cloud.calls.upsert).toBeLessThanOrEqual(2);
  });

  it('a change that arrives from another device appears after the server’s nudge', async () => {
    const other = fake.cloud.backend('u1');
    await other.upsert([
      { tbl: 'captures', id: 'remote-1', data: { id: 'remote-1', kind: 'text', text: 'с другого устройства', status: 'done', day: '2026-10-09', createdAt: '2026-10-09T10:00:00.000Z', updatedAt: '2026-10-09T10:00:00.000Z', projectIds: [], personIds: [], tags: [] } },
    ]);
    fake.realtime?.();
    await settle(150);
    expect((await capturesRepo.get('remote-1'))?.text).toBe('с другого устройства');
  });

  it('after taking in a remote change the rounds die down instead of chasing their own writes', async () => {
    await fake.cloud.backend('u1').upsert([
      { tbl: 'captures', id: 'remote-2', data: { id: 'remote-2', kind: 'text', text: 'ещё одна', status: 'done', day: '2026-10-09', createdAt: '2026-10-09T10:00:00.000Z', updatedAt: '2026-10-09T10:00:00.000Z', projectIds: [], personIds: [], tags: [] } },
    ]);
    fake.realtime?.();
    await settle(200);
    const pulls = fake.cloud.calls.pull;
    await sleep(400);
    expect(fake.cloud.calls.pull).toBe(pulls);
    expect(pulls).toBeLessThan(12);
  });

  it('a lost connection is shown as such, then healed by itself', async () => {
    await capturesRepo.create({ kind: 'text', text: 'в метро', status: 'done' });
    fake.cloud.offline = true;
    await settle(150);
    expect(useCloud.getState().status).toBe('offline');
    expect(fake.cloud.table('captures')).toHaveLength(0);
    fake.cloud.offline = false;
    await settle(400);
    expect(useCloud.getState().status).toBe('idle');
    expect(fake.cloud.table('captures')).toHaveLength(1);
  });

  it('signing out stops everything and forgets the cloud’s bookkeeping, but keeps the records', async () => {
    await capturesRepo.create({ kind: 'text', text: 'моё', status: 'done' });
    await settle(150);
    await signOut();
    expect(useCloud.getState()).toMatchObject({ status: 'signed-out', userId: null });
    const upserts = fake.cloud.calls.upsert;
    await capturesRepo.create({ kind: 'text', text: 'после выхода', status: 'done' });
    await settle(300);
    expect(fake.cloud.calls.upsert).toBe(upserts);
    expect(await db.captures.count()).toBe(2);
    expect(await db.syncmeta.count()).toBe(0);
    expect(fake.channelsRemoved).toBeGreaterThan(0);
  });

  it('syncNow can be called any number of times while a round is running', async () => {
    await Promise.all([syncNow(), syncNow(), syncNow({ push: true })]);
    await settle();
    expect(useCloud.getState().status).toBe('idle');
  });
});

describe('another account on the same device', () => {
  it('is not mixed in until the user chooses', async () => {
    await capturesRepo.create({ kind: 'text', text: 'данные первого', status: 'done' });
    await signIn('first@example.com', 'good-password');
    await settle();
    await signOut();
    // Signing out forgets bookkeeping, so the same account may come back freely; a different one is a conflict
    // only while bookkeeping still names the first. Put it back as an interrupted sign-out would leave it.
    await db.syncmeta.put({ id: '@user', v: 'u1' });
    fake.userId = 'u2';
    await signIn('second@example.com', 'good-password');
    await settle();
    expect(useCloud.getState().status).toBe('account-conflict');
    expect(fake.cloud.table('captures', 'u2')).toHaveLength(0);

    await resolveAccountConflict('replace');
    await settle();
    expect(useCloud.getState().status).toBe('idle');
    expect(await db.captures.count()).toBe(0);
  });
});

describe('deleting the cloud copy', () => {
  it('removes everything of the account there and signs out, leaving the device alone', async () => {
    await capturesRepo.create({ kind: 'text', text: 'останется здесь', status: 'done' });
    await signIn('max@example.com', 'good-password');
    await settle();
    expect(fake.cloud.table('captures')).toHaveLength(1);
    await wipeCloud();
    expect(fake.cloud.table('captures')).toHaveLength(0);
    expect(useCloud.getState().status).toBe('signed-out');
    expect(await db.captures.count()).toBe(1);
  });
});
