-- ============================================================
-- SONAR — Messages d'administration planifiés
-- Crée le stockage sécurisé des annonces, leurs destinataires et livraisons,
-- puis le RPC qui délivre les messages arrivés à échéance aux comptes connectés.
-- À coller dans Supabase : SQL Editor → New query → Run
-- À exécuter après accounts.sql et read-later.sql
-- ============================================================

create table if not exists public.admin_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  audience text not null check (audience in ('all', 'selected', 'admins')),
  target_account_ids uuid[] not null default '{}',
  published_at timestamptz not null,
  created_by text not null,
  created_at timestamptz not null default now()
);

create index if not exists admin_announcements_published_at_idx
  on public.admin_announcements (published_at);

grant select on public.accounts to service_role;

alter table public.admin_announcements enable row level security;
revoke all on public.admin_announcements from anon, authenticated, public;
grant all on public.admin_announcements to service_role;

create table if not exists public.admin_announcement_deliveries (
  announcement_id uuid not null references public.admin_announcements(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  delivered_at timestamptz not null default now(),
  primary key (announcement_id, account_id)
);

alter table public.admin_announcement_deliveries enable row level security;
revoke all on public.admin_announcement_deliveries from anon, authenticated, public;
grant all on public.admin_announcement_deliveries to service_role;

alter table public.notifications
  add column if not exists body text,
  add column if not exists announcement_id uuid
    references public.admin_announcements(id) on delete set null;

create unique index if not exists notifications_account_announcement_idx
  on public.notifications (account_id, announcement_id)
  where announcement_id is not null;

create or replace function public.claim_admin_announcements()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  claimed_count integer;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  with eligible as (
    select announcement.id
    from public.admin_announcements as announcement
    where announcement.published_at <= now()
      and (
        announcement.audience = 'all'
        or auth.uid() = any(announcement.target_account_ids)
      )
      and exists (
        select 1
        from public.accounts as account
        where account.id = auth.uid()
      )
  ),
  claimed as (
    insert into public.admin_announcement_deliveries (announcement_id, account_id)
    select eligible.id, auth.uid()
    from eligible
    on conflict (announcement_id, account_id) do nothing
    returning announcement_id, account_id
  ),
  inserted_notifications as (
    insert into public.notifications (
      account_id,
      type,
      title,
      body,
      created_at,
      announcement_id
    )
    select
      claimed.account_id,
      'admin_message',
      announcement.title,
      announcement.body,
      announcement.published_at,
      announcement.id
    from claimed
    join public.admin_announcements as announcement
      on announcement.id = claimed.announcement_id
    on conflict (account_id, announcement_id)
      where announcement_id is not null
      do nothing
    returning id
  )
  select count(*) into claimed_count
  from inserted_notifications;

  return claimed_count;
end;
$$;

revoke all on function public.claim_admin_announcements() from public, anon;
grant execute on function public.claim_admin_announcements() to authenticated;
