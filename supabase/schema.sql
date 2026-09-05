-- Traction — write-only database. Nothing is ever read by the extension:
-- the public board is a static JSON file built from this table.
-- Paste this whole file into Supabase → SQL Editor → Run.

create table if not exists public.posts (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  device_id   uuid not null,
  type        text not null check (type in ('shipped','launch','first_sale','revenue','funding')),
  startup     text not null check (char_length(startup) between 1 and 40),
  value       text check (char_length(value) <= 18),
  note        text not null check (char_length(note) between 1 and 180),
  link        text check (link ~ '^https://' and char_length(link) <= 200),
  author      text check (char_length(author) <= 24),
  approved    boolean not null default false,
  rejected    boolean not null default false
);

create table if not exists public.cheers (
  post_id     uuid not null references public.posts(id) on delete cascade,
  device_id   uuid not null,
  created_at  timestamptz not null default now(),
  primary key (post_id, device_id)      -- one cheer per device, enforced by the key
);

create table if not exists public.reports (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references public.posts(id) on delete cascade,
  device_id   uuid not null,
  created_at  timestamptz not null default now()
);

create index if not exists posts_queue_idx on public.posts (created_at desc) where approved and not rejected;
create index if not exists posts_device_idx on public.posts (device_id, created_at desc);

-- ---------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------

alter table public.posts   enable row level security;
alter table public.cheers  enable row level security;
alter table public.reports enable row level security;

-- Nobody gets SELECT. Not even on their own rows. The feed is the JSON file,
-- so there is no read path to abuse and no way to scrape device_ids.

-- Insert, with the rate limit expressed as part of the policy itself:
-- at most 2 posts per device per rolling 24 hours.
drop policy if exists "anon can post, twice a day" on public.posts;
create policy "anon can post, twice a day"
  on public.posts for insert to anon
  with check (
    approved is false
    and rejected is false
    and (
      select count(*) from public.posts p
      where p.device_id = posts.device_id
        and p.created_at > now() - interval '24 hours'
    ) < 2
  );

drop policy if exists "anon can cheer" on public.cheers;
create policy "anon can cheer"
  on public.cheers for insert to anon
  with check (
    (select count(*) from public.cheers c
      where c.device_id = cheers.device_id
        and c.created_at > now() - interval '1 hour') < 60
  );

drop policy if exists "anon can report" on public.reports;
create policy "anon can report"
  on public.reports for insert to anon with check (true);

-- ---------------------------------------------------------------
-- Moderation
-- ---------------------------------------------------------------
-- Everything lands with approved = false and is invisible until you flip it.
-- Supabase's table editor is your moderation queue; no tooling to build.
--
--   Approve one:   update public.posts set approved = true where id = '…';
--   Approve all pending from today:
--     update public.posts set approved = true
--     where not approved and not rejected and created_at > now() - interval '1 day';
--
-- This view is what the build script reads, ordered newest first.

create or replace view public.board as
  select
    p.id,
    p.created_at as at,
    p.type,
    p.startup,
    p.value,
    p.note,
    p.link,
    p.author,
    (select count(*) from public.cheers c where c.post_id = p.id) as cheers,
    (select count(*) from public.reports r where r.post_id = p.id) as reports
  from public.posts p
  where p.approved and not p.rejected
  order by p.created_at desc
  limit 200;
