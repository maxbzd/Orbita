import type { ID } from '../domain/types';
import type { RemoteRow, SyncBackend } from './engine';
import type { SyncTable } from './rows';

/**
 * An in-memory stand-in for the server, with the same rules as the SQL triggers: the server stamps `updated_at`,
 * an older version never replaces a newer one, a tombstone removes its record. One `FakeCloud` serves any
 * number of devices (`cloud.backend(userId)`).
 */
export class FakeCloud {
  rows = new Map<string, RemoteRow & { userId: string; ver?: string }>();
  audio = new Map<string, Blob>();
  private tick = 0;
  /** Set to make every call fail, like a lost connection. */
  offline = false;
  calls = { upsert: 0, pull: 0, upload: 0, download: 0 };

  private stamp(): string {
    this.tick += 1;
    return new Date(Date.UTC(2026, 9, 9, 12, 0, 0) + this.tick * 1000).toISOString();
  }

  private check(): void {
    if (this.offline) throw new TypeError('Failed to fetch');
  }

  backend(userId: string): SyncBackend {
    const key = (tbl: string, id: string): string => `${userId}/${tbl}/${id}`;
    return {
      userId,
      upsert: async (rows) => {
        this.check();
        this.calls.upsert += 1;
        const conflicts: string[] = [];
        const sealed = (value: unknown): value is { _e2e: 1; k: string } => !!value && typeof value === 'object' && (value as { _e2e?: unknown })._e2e === 1;
        // the version the server orders by: the stamp sent next to the record, or the record's own, as the SQL guard does
        const versionOf = (value: unknown, ver?: string): string | undefined => {
          const record = value as { updatedAt?: string; deletedAt?: string };
          return ver ?? (sealed(value) ? undefined : (record.updatedAt ?? record.deletedAt));
        };
        for (const { tbl, id, data, ver, base, target } of rows) {
          const old = this.rows.get(key(tbl, id));
          const oldVersion = old ? versionOf(old.data, old.ver) : undefined;
          // a write built on a cloud copy that has changed since is refused, and reported
          if (old && base !== undefined && oldVersion !== base) {
            conflicts.push(`${tbl}:${id}`);
            continue;
          }
          if (old) {
            const newVersion = versionOf(data, ver);
            // sealing a record that was stored in the clear (or with another key) may repeat its version
            const resealed = sealed(data) && (!sealed(old.data) || old.data.k !== data.k);
            if (oldVersion !== undefined && newVersion !== undefined && (newVersion < oldVersion || (newVersion === oldVersion && !resealed))) continue;
          }
          this.rows.set(key(tbl, id), { tbl, id, data: structuredClone(data), updated_at: this.stamp(), userId, ver: versionOf(data, ver) });
          if (tbl === 'tombstones') {
            const targetTable = target ?? (data as { table?: string }).table ?? '';
            const targetId = (data as { id?: string }).id ?? id;
            const deletedAt = versionOf(data, ver) ?? '';
            const victim = this.rows.get(key(targetTable, targetId));
            if (victim && (versionOf(victim.data, victim.ver) ?? '') <= deletedAt) this.rows.delete(key(targetTable, targetId));
          }
        }
        return { conflicts };
      },
      pull: async (since, limit) => {
        this.check();
        this.calls.pull += 1;
        return [...this.rows.values()]
          .filter((row) => row.userId === userId && (since === null || row.updated_at >= since))
          .sort((a, b) => (a.updated_at < b.updated_at ? -1 : a.updated_at > b.updated_at ? 1 : 0))
          .slice(0, limit)
          .map(({ userId: _owner, ver: _ver, ...row }) => structuredClone(row));
      },
      listAudio: async () => {
        this.check();
        return new Set([...this.audio.keys()].filter((name) => name.startsWith(`${userId}/`)).map((name) => name.slice(userId.length + 1) as ID));
      },
      uploadAudio: async (captureId, blob) => {
        this.check();
        this.calls.upload += 1;
        this.audio.set(`${userId}/${captureId}`, blob);
      },
      downloadAudio: async (captureId) => {
        this.check();
        this.calls.download += 1;
        return this.audio.get(`${userId}/${captureId}`) ?? null;
      },
      removeAudio: async (captureIds) => {
        this.check();
        for (const captureId of captureIds) this.audio.delete(`${userId}/${captureId}`);
      },
    };
  }

  /** Rows of one table, parsed back, for assertions. */
  table(tbl: SyncTable, userId = 'u1'): unknown[] {
    return [...this.rows.values()].filter((row) => row.userId === userId && row.tbl === tbl).map((row) => row.data);
  }
}
