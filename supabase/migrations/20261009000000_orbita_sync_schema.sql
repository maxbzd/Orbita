-- Orbita cloud sync: one row per synced record, owned by one user.
-- Applied to the Supabase project with the migration of the same name.
create table public.sync_rows (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  tbl text not null check (tbl in ('captures','items','people','projects','checkins','patterns','reviews','profile','presets','links','usage','tombstones')),
  id text not null check (char_length(id) between 1 and 200),
  data jsonb not null,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, tbl, id)
);

comment on table public.sync_rows is 'Orbita: synced records. data is the client record as JSON; updated_at is the server clock used as the pull cursor.';

create index sync_rows_pull_idx on public.sync_rows (user_id, updated_at);

alter table public.sync_rows enable row level security;

create policy "sync_rows_select_own" on public.sync_rows for select to authenticated
  using (user_id = (select auth.uid()));
create policy "sync_rows_insert_own" on public.sync_rows for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "sync_rows_update_own" on public.sync_rows for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "sync_rows_delete_own" on public.sync_rows for delete to authenticated
  using (user_id = (select auth.uid()));

-- Server clock for the cursor, owner never changes, and an older version never overwrites a newer one
-- (the client sends whole records; the one with the later updatedAt / deletedAt wins).
create function public.sync_rows_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  old_version text;
  new_version text;
begin
  new.updated_at := clock_timestamp();
  if tg_op = 'UPDATE' then
    new.user_id := old.user_id;
    new.tbl := old.tbl;
    new.id := old.id;
    old_version := coalesce(old.data ->> 'updatedAt', old.data ->> 'deletedAt');
    new_version := coalesce(new.data ->> 'updatedAt', new.data ->> 'deletedAt');
    if old_version is not null and new_version is not null and new_version <= old_version then
      return null;
    end if;
  end if;
  return new;
end;
$$;

create trigger sync_rows_guard_trg
  before insert or update on public.sync_rows
  for each row execute function public.sync_rows_guard();

-- A tombstone (a record deleted for good) removes the record from the cloud unless it was edited after the deletion.
create function public.sync_rows_apply_tombstone() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.tbl = 'tombstones' then
    delete from public.sync_rows r
    where r.user_id = new.user_id
      and r.tbl = new.data ->> 'table'
      and r.id = new.data ->> 'id'
      and coalesce(r.data ->> 'updatedAt', '') <= coalesce(new.data ->> 'deletedAt', '');
  end if;
  return null;
end;
$$;

create trigger sync_rows_tombstone_trg
  after insert or update on public.sync_rows
  for each row execute function public.sync_rows_apply_tombstone();

-- Live changes for other devices.
alter publication supabase_realtime add table public.sync_rows;

-- Private bucket for recordings: audio/<user id>/<capture id>.
insert into storage.buckets (id, name, public, file_size_limit)
values ('audio', 'audio', false, 52428800)
on conflict (id) do nothing;

create policy "audio_select_own" on storage.objects for select to authenticated
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "audio_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'audio' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "audio_update_own" on storage.objects for update to authenticated
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'audio' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "audio_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = (select auth.uid())::text);
