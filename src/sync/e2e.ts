import { db } from '../db';
import { E2ELockedError } from './engine';
import type { SyncBackend } from './engine';
import type { CloudKey } from './e2eCrypto';

/**
 * Seals what leaves the device and opens what arrives, around any backend. The engine does not know: it hands over
 * plain records and gets plain records back. The heavy part (`e2eCrypto.ts`) is only loaded when there is a key or
 * the cloud holds sealed data.
 */

const isEnvelopeLike = (value: unknown): boolean => !!value && typeof value === 'object' && (value as { _e2e?: unknown })._e2e === 1;

let cache: { raw: string; key: CloudKey } | null = null;

/** The cloud key of this device, or `null` when there is none. */
export async function currentCloudKey(): Promise<CloudKey | null> {
  const raw = (await db.settings.get('settings'))?.e2e?.key;
  if (!raw) return null;
  if (cache?.raw === raw) return cache.key;
  const { importCloudKey } = await import('./e2eCrypto');
  const { fromBase64 } = await import('@/crypto/bytes');
  const key = await importCloudKey(fromBase64(raw));
  cache = { raw, key };
  return key;
}

export function withE2E(inner: SyncBackend): SyncBackend {
  return {
    userId: inner.userId,

    async upsert(rows) {
      const key = await currentCloudKey();
      if (!key) return inner.upsert(rows);
      const { sealRecord } = await import('./e2eCrypto');
      return inner.upsert(await Promise.all(rows.map(async (row) => ({ ...row, data: await sealRecord(key, row.tbl, row.id, row.data) }))));
    },

    async pull(since, limit) {
      const rows = await inner.pull(since, limit);
      if (!rows.some((row) => isEnvelopeLike(row.data))) return rows;
      // Sealed data and no key (or another one): nothing may be read, and nothing may be sent next to it.
      const key = await currentCloudKey();
      if (!key) throw new E2ELockedError();
      const { isEnvelope, openRecord } = await import('./e2eCrypto');
      return Promise.all(
        rows.map(async (row) => {
          if (!isEnvelope(row.data)) return row;
          const plain = await openRecord(key, row.tbl, row.id, row.data);
          if (plain === undefined) throw new E2ELockedError();
          return { ...row, data: plain };
        }),
      );
    },

    listAudio: () => inner.listAudio(),

    async uploadAudio(captureId, blob) {
      const key = await currentCloudKey();
      if (!key) return inner.uploadAudio(captureId, blob);
      const { sealAudio } = await import('./e2eCrypto');
      return inner.uploadAudio(captureId, await sealAudio(key, captureId, blob));
    },

    async downloadAudio(captureId) {
      const blob = await inner.downloadAudio(captureId);
      if (!blob) return null;
      const crypto = await import('./e2eCrypto');
      if (!(await crypto.isSealedAudio(blob))) return blob; // stored before encryption was turned on
      const key = await currentCloudKey();
      if (!key) throw new E2ELockedError();
      const plain = await crypto.openAudio(key, captureId, blob);
      if (!plain) throw new E2ELockedError();
      return plain;
    },

    removeAudio: (captureIds) => inner.removeAudio(captureIds),
  };
}
