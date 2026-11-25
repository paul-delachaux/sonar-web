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

create table if not exists public.admin_site_feedback_messages (
  id uuid primary key default gen_random_uuid(),
  feedback_id uuid not null references public.admin_site_feedback (id) on delete cascade,
  author_login text not null,
  author_name text not null,
  author_role text not null check (author_role in ('admin', 'superadmin')),
  body text not null check (char_length(body) between 1 and 5000),
  created_at timestamptz not null default now()
);

create index if not exists admin_site_feedback_messages_feedback_idx
  on public.admin_site_feedback_messages (feedback_id, created_at);

create or replace function public.add_admin_feedback_message(
  p_feedback_id uuid,
  p_author_login text,
  p_author_name text,
  p_author_role text,
  p_body text,
  p_resolve boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  feedback_row public.admin_site_feedback%rowtype;
  message_row public.admin_site_feedback_messages%rowtype;
begin
  select * into feedback_row
  from public.admin_site_feedback
  where id = p_feedback_id
  for update;

  if not found then
    raise exception 'Cette demande n’existe plus.';
  end if;
  if feedback_row.status <> 'pending' then
    raise exception 'Cette demande est déjà résolue.';
  end if;
  if p_author_role not in ('admin', 'superadmin') then
    raise exception 'Rôle non autorisé.';
  end if;
  if p_author_role = 'admin' and feedback_row.created_by <> p_author_login then
    raise exception 'Vous ne pouvez répondre qu’à vos propres demandes.';
  end if;
  if p_resolve and p_author_role <> 'superadmin' then
    raise exception 'Seul un superadmin peut résoudre une demande.';
  end if;

  insert into public.admin_site_feedback_messages (
    feedback_id, author_login, author_name, author_role, body
  ) values (
    p_feedback_id, p_author_login, p_author_name, p_author_role, btrim(p_body)
  )
  returning * into message_row;

  update public.admin_site_feedback
  set updated_at = now(),
      status = case when p_resolve then 'resolved' else status end,
      resolved_by = case when p_resolve then p_author_login else resolved_by end,
      resolved_at = case when p_resolve then now() else resolved_at end
  where id = p_feedback_id;

  return to_jsonb(message_row);
end;
$$;

revoke all on public.admin_site_feedback_messages from anon, authenticated, public;
grant all on public.admin_site_feedback_messages to service_role;
revoke all on function public.add_admin_feedback_message(uuid, text, text, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.add_admin_feedback_message(uuid, text, text, text, text, boolean)
  to service_role;

alter table public.admin_site_feedback enable row level security;
alter table public.admin_site_feedback_messages enable row level security;
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
