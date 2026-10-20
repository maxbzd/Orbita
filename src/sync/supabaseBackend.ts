import type { SupabaseClient } from '@supabase/supabase-js';
import type { ID } from '../domain/types';
import { AUDIO_BUCKET } from './config';
import type { RemoteRow, SyncBackend } from './engine';
import type { SyncTable } from './rows';
import { t } from '../i18n';

function fail(what: string, error: { message: string }): never {
  throw new Error(`${what}: ${error.message}`);
}

/** The engine's view of a Supabase project: the `sync_rows` table and the private `audio` bucket. */
export function createSupabaseBackend(client: SupabaseClient, userId: string): SyncBackend {
  const audio = () => client.storage.from(AUDIO_BUCKET);
  const path = (captureId: ID): string => `${userId}/${captureId}`;

  return {
    userId,

    async upsert(rows) {
      if (rows.length === 0) return;
      const { error } = await client
        .from('sync_rows')
        .upsert(rows.map(({ tbl, id, data }) => ({ user_id: userId, tbl, id, data })), { onConflict: 'user_id,tbl,id' });
      if (error) fail(t('Could not send data'), error);
    },

    async pull(since, limit) {
      let query = client.from('sync_rows').select('tbl,id,data,updated_at').eq('user_id', userId);
      if (since) query = query.gte('updated_at', since);
      const { data, error } = await query.order('updated_at', { ascending: true }).order('tbl').order('id').limit(limit);
      if (error) fail(t('Could not get data'), error);
      return (data ?? []) as { tbl: SyncTable; id: ID; data: unknown; updated_at: string }[] satisfies RemoteRow[];
    },

    async listAudio() {
      const names = new Set<ID>();
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await audio().list(userId, { limit: 1000, offset });
        if (error) fail(t('Could not get the list of records'), error);
        for (const entry of data ?? []) names.add(entry.name);
        if ((data?.length ?? 0) < 1000) break;
      }
      return names;
    },

    async uploadAudio(captureId, blob) {
      // The bucket stores the type without codec parameters; the player does not need them.
      const contentType = (blob.type || 'audio/webm').split(';')[0] ?? 'audio/webm';
      const { error } = await audio().upload(path(captureId), blob, { upsert: true, contentType });
      if (error) fail(t('Could not upload the audio'), error);
    },

    async downloadAudio(captureId) {
      const { data, error } = await audio().download(path(captureId));
      if (error || !data) return null;
      return data;
    },

    async removeAudio(captureIds) {
      if (captureIds.length === 0) return;
      const { error } = await audio().remove(captureIds.map(path));
      if (error) fail(t('Could not delete the audio'), error);
    },
  };
}

/** Everything of this user in the cloud, for good: records and recordings. */
export async function deleteCloudData(client: SupabaseClient, userId: string): Promise<void> {
  const backend = createSupabaseBackend(client, userId);
  const ids = [...(await backend.listAudio())];
  for (let start = 0; start < ids.length; start += 100) await backend.removeAudio(ids.slice(start, start + 100));
  const { error } = await client.from('sync_rows').delete().eq('user_id', userId);
  if (error) fail(t('Could not delete data in the cloud'), error);
}
