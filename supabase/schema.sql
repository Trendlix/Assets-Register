-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.

create table if not exists public.docs (
  collection text not null,
  id         text not null,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (collection, id)
);

-- Atomic partial update (equivalent of Firestore update()).
create or replace function public.merge_doc(p_collection text, p_id text, p_patch jsonb)
returns void language sql security invoker as $$
  insert into public.docs(collection, id, data) values (p_collection, p_id, p_patch)
  on conflict (collection, id) do update
    set data = public.docs.data || excluded.data, updated_at = now();
$$;

-- OPEN ACCESS: anyone with the site URL (and the public anon key) can read and write.
-- To lock it down later, enable Supabase Auth and replace these policies with
-- "to authenticated".
alter table public.docs enable row level security;
drop policy if exists "open access" on public.docs;
create policy "open access" on public.docs for all to anon, authenticated using (true) with check (true);

-- Live updates
alter table public.docs replica identity full;
alter publication supabase_realtime add table public.docs;

-- Photo storage (public bucket; files are named by random UUID)
insert into storage.buckets (id, name, public) values ('assets', 'assets', true)
on conflict (id) do nothing;
drop policy if exists "assets open insert" on storage.objects;
drop policy if exists "assets open delete" on storage.objects;
create policy "assets open insert" on storage.objects for insert to anon, authenticated with check (bucket_id = 'assets');
create policy "assets open delete" on storage.objects for delete to anon, authenticated using (bucket_id = 'assets');
