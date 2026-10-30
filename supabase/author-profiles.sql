-- Author profiles are editable in the admin and read by the server-rendered site.
-- All database access is server-side through the service_role key.

create table if not exists public.author_profiles (
  name text primary key check (char_length(name) between 1 and 100),
  account text,
  avatar text,
  about text,
  about_en text,
  interests text,
  interests_en text,
  partners text,
  partners_en text,
  updated_at timestamptz not null default now()
);

create index if not exists author_profiles_account_idx
  on public.author_profiles (lower(account))
  where account is not null;

alter table public.author_profiles enable row level security;
revoke all on public.author_profiles from public, anon, authenticated;
grant select, insert, update, delete on public.author_profiles to service_role;

insert into public.author_profiles (name, account, avatar, about)
values
  (
    'Victor Zhâ',
    'souslesonar-hash',
    null,
    'Diplômé de l''université de la Sorbone et issu des écoles préparatoires françaises aux grandes écoles.'
  ),
  ('Paul Delachaux', 'paul-delachaux', null, null),
  ('Amaury Renouf', 'amauritoss', null, null),
  ('Paul-test', 'amazingrenaud', '/assets/uploads/avatar-paul-test-2be0a181114f.png', null)
on conflict (name) do nothing;

insert into storage.buckets (id, name, public)
values ('author-avatars', 'author-avatars', true)
on conflict (id) do update set public = excluded.public;
