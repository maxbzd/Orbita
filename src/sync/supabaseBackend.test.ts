import { describe, expect, it, vi } from 'vitest';
import { createSupabaseBackend } from './supabaseBackend';
import type { SupabaseClient } from '@supabase/supabase-js';

function client(rpc: ReturnType<typeof vi.fn>, upsert = vi.fn(async () => ({ error: null }))) {
  return { rpc, from: vi.fn(() => ({ upsert })) } as unknown as SupabaseClient;
}
const row = { tbl: 'items' as const, id: 'i1', data: { title: 'x' }, ver: '2026-01-01T00:00:00.000Z', base: '2025-01-01T00:00:00.000Z' };

describe('sending records to a Supabase project', () => {
  it('goes through the checking function and passes back what the server refused', async () => {
    const rpc = vi.fn(async () => ({ data: { applied: 0, stale: 0, conflicts: ['items:i1'] }, error: null }));
    const backend = createSupabaseBackend(client(rpc), 'u1');
    expect(await backend.upsert([row])).toEqual({ conflicts: ['items:i1'] });
    expect(rpc).toHaveBeenCalledWith('orbita_sync_push', { rows: [row] });
  });

  it('a project without the latest migration still takes plain records, the old way', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.orbita_sync_push(rows) in the schema cache' } }));
    const upsert = vi.fn(async () => ({ error: null }));
    const backend = createSupabaseBackend(client(rpc, upsert), 'u1');
    expect(await backend.upsert([row])).toEqual({ conflicts: [] });
    expect(upsert).toHaveBeenCalledTimes(1);
    await backend.upsert([row]);
    expect(rpc).toHaveBeenCalledTimes(1); // it does not ask again
  });

  it('but it refuses to put sealed records there, where nothing would order or clean them', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }));
    const upsert = vi.fn(async () => ({ error: null }));
    const backend = createSupabaseBackend(client(rpc, upsert), 'u1');
    await expect(backend.upsert([{ ...row, data: { _e2e: 1, k: 'k', iv: 'i', c: 'c' } }])).rejects.toThrow(/migration/);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('other errors are reported, not swallowed', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { code: '42501', message: 'permission denied' } }));
    const backend = createSupabaseBackend(client(rpc), 'u1');
    await expect(backend.upsert([row])).rejects.toThrow(/permission denied/);
  });
});
