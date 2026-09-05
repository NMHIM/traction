-- Traction v2 migration.
-- Run this in Supabase → SQL Editor if you already ran the v1 schema.
-- Safe to run twice.

-- ---------------------------------------------------------------
-- 1. The richer profile fields
-- ---------------------------------------------------------------

alter table public.posts add column if not exists about       text;
alter table public.posts add column if not exists website     text;
alter table public.posts add column if not exists social      text;
alter table public.posts add column if not exists linkedin    text;
alter table public.posts add column if not exists stage       text;
alter table public.posts add column if not exists looking_for text[];

alter table public.posts drop constraint if exists posts_about_len;
alter table public.posts add  constraint posts_about_len check (about is null or char_length(about) <= 600);

alter table public.posts drop constraint if exists posts_stage_valid;
alter table public.posts add  constraint posts_stage_valid check (
  stage is null or stage in ('idea','building','live','revenue','funded')
);

-- Every link must be https and sane length. Cheap, and blocks javascript: tricks.
do $$
declare col text;
begin
  foreach col in array array['website','social','linkedin'] loop
    execute format('alter table public.posts drop constraint if exists posts_%s_url', col);
    execute format(
      'alter table public.posts add constraint posts_%s_url check (%I is null or (%I ~ ''^https://'' and char_length(%I) <= 200))',
      col, col, col, col);
  end loop;
end $$;

-- Cap the tag list so nobody stuffs it.
alter table public.posts drop constraint if exists posts_looking_len;
alter table public.posts add  constraint posts_looking_len check (
  looking_for is null or array_length(looking_for, 1) <= 6
);

-- ---------------------------------------------------------------
-- 2. Ownership — how a person edits or deletes their own post
-- ---------------------------------------------------------------
-- There are no accounts, so ownership is a secret token the browser
-- generates at post time and keeps in local storage. It is never
-- published in feed.json and there is no SELECT policy on this table,
-- so there is no way to discover someone else's token.

alter table public.posts add column if not exists edit_token uuid;

create index if not exists posts_edit_token_idx on public.posts (id, edit_token);

-- ---------------------------------------------------------------
-- 3. Edit and delete, via functions rather than direct table access
-- ---------------------------------------------------------------
-- anon never gets UPDATE or DELETE on the table itself. It can only call
-- these two functions, and both demand the matching token.

create or replace function public.delete_my_post(p_id uuid, p_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare hit int;
begin
  delete from public.posts
   where id = p_id and edit_token = p_token;
  get diagnostics hit = row_count;
  return hit > 0;
end $$;

create or replace function public.update_my_post(
  p_id uuid, p_token uuid,
  p_type text, p_startup text, p_value text, p_note text,
  p_about text, p_website text, p_social text, p_linkedin text,
  p_stage text, p_looking_for text[], p_author text, p_link text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare hit int;
begin
  -- An edit sends the post back through review. Without this, someone could
  -- get an innocuous post approved and then rewrite it into anything.
  update public.posts set
    type        = p_type,
    startup     = p_startup,
    value       = p_value,
    note        = p_note,
    about       = p_about,
    website     = p_website,
    social      = p_social,
    linkedin    = p_linkedin,
    stage       = p_stage,
    looking_for = p_looking_for,
    author      = p_author,
    link        = p_link,
    approved    = false,
    rejected    = false
  where id = p_id and edit_token = p_token;
  get diagnostics hit = row_count;
  return hit > 0;
end $$;

revoke all on function public.delete_my_post(uuid, uuid) from public;
revoke all on function public.update_my_post(uuid, uuid, text, text, text, text, text, text, text, text, text, text[], text, text) from public;
grant execute on function public.delete_my_post(uuid, uuid) to anon;
grant execute on function public.update_my_post(uuid, uuid, text, text, text, text, text, text, text, text, text, text[], text, text) to anon;

-- ---------------------------------------------------------------
-- 4. The board view, now carrying the profile fields
-- ---------------------------------------------------------------
-- edit_token and device_id are deliberately absent: this view is what
-- gets published to a public CDN.

drop view if exists public.board;
create view public.board as
  select
    p.id,
    p.created_at as at,
    p.type,
    p.startup,
    p.value,
    p.note,
    p.about,
    p.link,
    p.website,
    p.social,
    p.linkedin,
    p.stage,
    p.looking_for,
    p.author,
    (select count(*) from public.cheers c where c.post_id = p.id) as cheers,
    (select count(*) from public.reports r where r.post_id = p.id) as reports
  from public.posts p
  where p.approved and not p.rejected
  order by p.created_at desc
  limit 200;

-- ---------------------------------------------------------------
-- 5. Posting policy, updated for client-supplied ids
-- ---------------------------------------------------------------

drop policy if exists "anon can post, twice a day" on public.posts;
create policy "anon can post, twice a day"
  on public.posts for insert to anon
  with check (
    approved is false
    and rejected is false
    and edit_token is not null
    and (
      select count(*) from public.posts p
      where p.device_id = posts.device_id
        and p.created_at > now() - interval '24 hours'
    ) < 2
  );
