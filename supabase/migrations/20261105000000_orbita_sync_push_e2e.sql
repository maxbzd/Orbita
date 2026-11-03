-- Orbita cloud sync, second step: optimistic concurrency and end-to-end encryption.
--
-- 1. Each row now carries its own version stamp (`ver`) next to the record. Until now the guard read the version out of
--    `data` (updatedAt / deletedAt); a record sealed on the device (data = {"_e2e":1,...}) has no readable version, so the
--    device sends the stamp separately. Rows written by older app versions keep working: the stamp is read from `data` then.
-- 2. `orbita_sync_push` writes a batch and refuses a record whose `base` (the version the edit was built on) is no longer
--    what the cloud holds. The device reads again, merges the two edits, and sends the merged record. Two devices writing
--    at the same moment can no longer overwrite each other's fields.
-- 3. A tombstone names the table of the record it deletes (`target_tbl`), so the cloud can clear that record although it
--    cannot read the sealed tombstone.
-- Sealing a record that is already stored in the clear (or with another key) may repeat its version stamp; any other write
-- needs a later one.

alter table public.sync_rows add column if not exists ver text;
alter table public.sync_rows add column if not exists target_tbl text;

comment on column public.sync_rows.ver is 'Orbita: the record''s own version stamp (updatedAt, or deletedAt of a tombstone), readable even when data is sealed.';
comment on column public.sync_rows.target_tbl is 'Orbita: for tombstones, the table of the deleted record.';

-- Fill the stamp of the rows that are already there, without waking the triggers (the cursor must not move).
alter table public.sync_rows disable trigger user;
update public.sync_rows set ver = coalesce(data ->> 'updatedAt', data ->> 'deletedAt') where ver is null;
alter table public.sync_rows enable trigger user;

create or replace function public.sync_rows_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  old_version text;
  new_version text;
  resealed boolean;
begin
  new.updated_at := clock_timestamp();
  -- a record in the clear tells its own version; a sealed one comes with the stamp the device sent
  if not (new.data ? '_e2e') then
    new.ver := coalesce(new.data ->> 'updatedAt', new.data ->> 'deletedAt', new.ver);
  end if;
  if tg_op = 'UPDATE' then
    new.user_id := old.user_id;
    new.tbl := old.tbl;
    new.id := old.id;
    old_version := coalesce(old.ver, old.data ->> 'updatedAt', old.data ->> 'deletedAt');
    new_version := new.ver;
    if old_version is not null and new_version is not null then
      resealed := (new.data ? '_e2e') and (not (old.data ? '_e2e') or (old.data ->> 'k') is distinct from (new.data ->> 'k'));
      if new_version < old_version or (new_version = old_version and not resealed) then
        return null;
      end if;
    end if;
  end if;
  return new;
end;
$$;

-- A tombstone clears the record from the cloud unless it was edited after the deletion. It works on a sealed tombstone too:
-- the table comes from `target_tbl`, the id is the tombstone's own, the time is its stamp.
create or replace function public.sync_rows_apply_tombstone() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.tbl = 'tombstones' then
    delete from public.sync_rows r
    where r.user_id = new.user_id
      and r.tbl = coalesce(new.target_tbl, new.data ->> 'table')
      and r.id = coalesce(new.data ->> 'id', new.id)
      and coalesce(r.ver, r.data ->> 'updatedAt', '') <= coalesce(new.ver, new.data ->> 'deletedAt', '');
  end if;
  return null;
end;
$$;

-- Writes a batch of whole records. Each element: { tbl, id, data, ver?, base?, target? }.
-- Returns { applied, stale, conflicts }: `conflicts` lists "table:id" of records refused because the cloud copy is no longer
-- the one the edit was built on (`base`). Runs with the caller's rights, so row-level security applies as to a direct write.
create or replace function public.orbita_sync_push(rows jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r jsonb;
  v_tbl text;
  v_id text;
  v_base text;
  v_current text;
  v_found boolean;
  got int;
  n_applied int := 0;
  n_stale int := 0;
  v_conflicts jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if jsonb_typeof(rows) is distinct from 'array' then
    raise exception 'rows must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(rows) > 500 then
    raise exception 'too many rows (max 500)' using errcode = '22023';
  end if;

  for r in select * from jsonb_array_elements(rows) loop
    v_tbl := r ->> 'tbl';
    v_id := r ->> 'id';
    if jsonb_typeof(r -> 'data') is distinct from 'object' then
      raise exception 'record needs object data' using errcode = '23514';
    end if;
    v_base := r ->> 'base';

    if v_base is not null then
      -- Lock the row, so two devices writing at the same moment are decided one after the other.
      select coalesce(s.ver, s.data ->> 'updatedAt', s.data ->> 'deletedAt') into v_current
        from public.sync_rows s
       where s.user_id = auth.uid() and s.tbl = v_tbl and s.id = v_id
         for update;
      v_found := found;
      if v_found and v_current is distinct from v_base then
        v_conflicts := v_conflicts || to_jsonb(v_tbl || ':' || v_id);
        continue;
      end if;
    end if;

    insert into public.sync_rows as s (tbl, id, data, ver, target_tbl)
    values (v_tbl, v_id, r -> 'data', r ->> 'ver', r ->> 'target')
    on conflict (user_id, tbl, id) do update
      set data = excluded.data,
          ver = excluded.ver,
          target_tbl = excluded.target_tbl;

    get diagnostics got = row_count;
    if got > 0 then n_applied := n_applied + 1; else n_stale := n_stale + 1; end if;
  end loop;

  return jsonb_build_object('applied', n_applied, 'stale', n_stale, 'conflicts', v_conflicts);
end;
$$;

revoke all on function public.orbita_sync_push(jsonb) from public, anon;
grant execute on function public.orbita_sync_push(jsonb) to authenticated;
