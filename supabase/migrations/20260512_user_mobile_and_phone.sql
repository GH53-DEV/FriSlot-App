-- Contact fields used by onboarding upsert (PostgREST schema must include these columns)
alter table if exists public.users
  add column if not exists mobile text;

alter table if exists public.users
  add column if not exists phone text;
