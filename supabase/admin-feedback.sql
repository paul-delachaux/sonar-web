-- SONAR — Retours d’amélioration de l’administration
-- À exécuter dans Supabase : SQL Editor → New query → Run.

create table if not exists public.admin_site_feedback (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 160),
  body text not null check (char_length(body) between 1 and 5000),
  status text not null default 'pending' check (status in ('pending', 'resolved')),
  attachments jsonb not null default '[]'::jsonb,
  created_by text not null,
  created_by_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_by text,
  resolved_at timestamptz
);

create index if not exists admin_site_feedback_created_at_idx
  on public.admin_site_feedback (created_at desc);
create index if not exists admin_site_feedback_created_by_idx
  on public.admin_site_feedback (created_by, created_at desc);
create index if not exists admin_site_feedback_status_idx
  on public.admin_site_feedback (status, created_at desc);

alter table public.admin_site_feedback enable row level security;
revoke all on public.admin_site_feedback from anon, authenticated, public;
grant all on public.admin_site_feedback to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'admin-feedback',
  'admin-feedback',
  false,
  4194304,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists admin_feedback_storage_private on storage.objects;
create policy admin_feedback_storage_private
  on storage.objects
  as restrictive
  for all
  to anon, authenticated
  using (bucket_id <> 'admin-feedback')
  with check (bucket_id <> 'admin-feedback');
