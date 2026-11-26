-- SONAR — Réponses privées aux sondages de La Sonde
-- À coller dans Supabase : SQL Editor → New query → Run.

create table if not exists public.sondage_responses (
  poll_slug text not null check (char_length(poll_slug) between 1 and 160),
  account_id uuid not null references public.accounts (id) on delete cascade,
  option_id text not null check (char_length(option_id) between 1 and 64),
  explanation text not null default '' check (char_length(explanation) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (poll_slug, account_id)
);

create index if not exists sondage_responses_poll_created_idx
  on public.sondage_responses (poll_slug, created_at desc);

alter table public.sondage_responses enable row level security;
revoke all on public.sondage_responses from anon, authenticated, public;
grant all on public.sondage_responses to service_role;

alter table public.sondage_responses
  drop constraint if exists sondage_responses_explanation_check;

do $migration$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.sondage_responses'::regclass
      and conname = 'sondage_responses_explanation_length_check'
  ) then
    alter table public.sondage_responses
      add constraint sondage_responses_explanation_length_check
      check (char_length(explanation) <= 200) not valid;
  end if;
end
$migration$;
