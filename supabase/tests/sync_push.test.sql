-- Server rules of Orbita sync, checked against a plain PostgreSQL with supabase/tests/stub.sql and every migration applied.
-- Run: scripts/test-sql.sh   (fails on the first assertion that does not hold)
\set ON_ERROR_STOP 1
\o /dev/null

insert into auth.users values ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000b2');
grant select, insert, update, delete on public.sync_rows to authenticated;

create function pg_temp.expect(label text, actual anyelement, wanted anyelement) returns void language plpgsql as $$
begin
  if actual is distinct from wanted then
    raise exception 'FAILED: % (got %, wanted %)', label, actual, wanted;
  end if;
end $$;
grant execute on function pg_temp.expect(text, anyelement, anyelement) to public;

create function pg_temp.push(rows jsonb) returns jsonb language sql as $$ select public.orbita_sync_push(rows) $$;

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';

-- a record written by the previous app version (no stamp column, version only inside data)
insert into public.sync_rows (tbl, id, data) values ('items', 'i1', '{"updatedAt":"2026-01-01T00:00:00.000Z","title":"old"}');
select pg_temp.expect('the stamp is read from a plain record', (select ver from public.sync_rows where id = 'i1'), '2026-01-01T00:00:00.000Z');

-- an edit built on the version the cloud holds is written
select pg_temp.expect('right base is applied',
  pg_temp.push('[{"tbl":"items","id":"i1","data":{"updatedAt":"2026-02-01T00:00:00.000Z","title":"v2"},"ver":"2026-02-01T00:00:00.000Z","base":"2026-01-01T00:00:00.000Z"}]') -> 'applied', '1'::jsonb);

-- an edit built on an out-of-date copy is refused and named, and nothing changes
select pg_temp.expect('stale base is a conflict',
  pg_temp.push('[{"tbl":"items","id":"i1","data":{"updatedAt":"2026-03-01T00:00:00.000Z","title":"on stale"},"ver":"2026-03-01T00:00:00.000Z","base":"2026-01-01T00:00:00.000Z"}]') -> 'conflicts', '["items:i1"]'::jsonb);
select pg_temp.expect('the refused edit was not stored', (select data ->> 'title' from public.sync_rows where id = 'i1'), 'v2');

-- an older version never replaces a newer one
select pg_temp.expect('older version is stale',
  pg_temp.push('[{"tbl":"items","id":"i1","data":{"updatedAt":"2026-01-15T00:00:00.000Z","title":"older"},"ver":"2026-01-15T00:00:00.000Z"}]') -> 'stale', '1'::jsonb);
select pg_temp.expect('older version was not stored', (select data ->> 'title' from public.sync_rows where id = 'i1'), 'v2');

-- sealing a record that is in the clear may repeat its stamp; sealing it again with the same key may not
select pg_temp.expect('reseal over plain is applied',
  pg_temp.push('[{"tbl":"items","id":"i1","data":{"_e2e":1,"k":"K1","iv":"x","c":"y"},"ver":"2026-02-01T00:00:00.000Z"}]') -> 'applied', '1'::jsonb);
select pg_temp.expect('same key and stamp again is stale',
  pg_temp.push('[{"tbl":"items","id":"i1","data":{"_e2e":1,"k":"K1","iv":"x2","c":"y2"},"ver":"2026-02-01T00:00:00.000Z"}]') -> 'stale', '1'::jsonb);
select pg_temp.expect('another key may reseal (key rotation)',
  pg_temp.push('[{"tbl":"items","id":"i1","data":{"_e2e":1,"k":"K2","iv":"x3","c":"y3"},"ver":"2026-02-01T00:00:00.000Z"}]') -> 'applied', '1'::jsonb);

-- a sealed edit with a later stamp and the right base
select pg_temp.expect('sealed edit is applied',
  pg_temp.push('[{"tbl":"items","id":"i1","data":{"_e2e":1,"k":"K2","iv":"x4","c":"y4"},"ver":"2026-04-01T00:00:00.000Z","base":"2026-02-01T00:00:00.000Z"}]') -> 'applied', '1'::jsonb);

-- a sealed tombstone clears the sealed record it names
select pg_temp.expect('tombstone applied',
  pg_temp.push('[{"tbl":"tombstones","id":"i1","data":{"_e2e":1,"k":"K2","iv":"a","c":"b"},"ver":"2026-05-01T00:00:00.000Z","target":"items"}]') -> 'applied', '1'::jsonb);
select pg_temp.expect('the deleted record is gone', (select count(*) from public.sync_rows where tbl = 'items' and id = 'i1'), 0::bigint);

-- but not a record edited after the deletion
select pg_temp.push('[{"tbl":"items","id":"i9","data":{"_e2e":1,"k":"K2","iv":"a","c":"b"},"ver":"2026-09-01T00:00:00.000Z"}]');
select pg_temp.push('[{"tbl":"tombstones","id":"i9","data":{"_e2e":1,"k":"K2","iv":"a","c":"b"},"ver":"2026-05-01T00:00:00.000Z","target":"items"}]');
select pg_temp.expect('a later edit survives an earlier deletion', (select count(*) from public.sync_rows where tbl = 'items' and id = 'i9'), 1::bigint);

-- an older app version writing the table directly is still guarded
insert into public.sync_rows (tbl, id, data) values ('people', 'p1', '{"updatedAt":"2026-01-01T00:00:00.000Z","name":"a"}');
insert into public.sync_rows (tbl, id, data) values ('people', 'p1', '{"updatedAt":"2025-01-01T00:00:00.000Z","name":"older"}')
  on conflict (user_id, tbl, id) do update set data = excluded.data;
select pg_temp.expect('direct write: older never wins', (select data ->> 'name' from public.sync_rows where id = 'p1'), 'a');

-- another account sees nothing of the first, and its own write to the same id is separate
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b2';
select pg_temp.expect('another account sees no rows', (select count(*) from public.sync_rows), 0::bigint);
select pg_temp.expect('another account writes its own row',
  pg_temp.push('[{"tbl":"people","id":"p1","data":{"updatedAt":"2026-01-01T00:00:00.000Z","name":"B"},"ver":"2026-01-01T00:00:00.000Z","base":"2026-01-01T00:00:00.000Z"}]') -> 'applied', '1'::jsonb);
reset role;
select pg_temp.expect('the first account''s row is untouched', (select data ->> 'name' from public.sync_rows where id = 'p1' and user_id = '00000000-0000-0000-0000-0000000000a1'), 'a');

-- no account, no write
set role authenticated;
set request.jwt.claim.sub = '';
do $$ begin
  perform public.orbita_sync_push('[]');
  raise exception 'FAILED: a call without an account was accepted';
exception when sqlstate '28000' then null;
end $$;
reset role;
set role anon;
do $$ begin
  perform public.orbita_sync_push('[]');
  raise exception 'FAILED: the anonymous role may call the function';
exception when insufficient_privilege then null;
end $$;
reset role;

\o
\echo 'sync_push: all checks passed'
