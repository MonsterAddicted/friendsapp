-- friendsapp update 2: "I'm free", time & place vote, "On my way"
-- Paste into Supabase > SQL Editor > New query > Run (after schema.sql).

-- ============ "I'M FREE" ============
create table public.availability (
  user_id uuid primary key references public.profiles on delete cascade,
  until timestamptz not null,
  up_for text not null default 'anything' check (up_for in ('anything', 'eat', 'party', 'sport', 'chill', 'gaming')),
  note text check (char_length(note) <= 80),
  updated_at timestamptz not null default now()
);
alter table public.availability enable row level security;
create policy "see own and group mates" on public.availability for select to authenticated
  using (user_id = auth.uid() or public.shares_group(user_id));
create policy "set own" on public.availability for insert to authenticated with check (user_id = auth.uid());
create policy "change own" on public.availability for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "clear own" on public.availability for delete to authenticated using (user_id = auth.uid());

-- ============ MEETUP EXTRAS ============
alter table public.meetups
  add column lat double precision,
  add column lng double precision,
  add column poll_locked boolean not null default false;

create or replace function public.meetup_member(m uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.meetups where id = m and public.is_member(group_id));
$$;

create or replace function public.meetup_creator(m uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.meetups where id = m and created_by = auth.uid());
$$;

-- ============ TIME & PLACE VOTE ============
create table public.meetup_options (
  id uuid primary key default gen_random_uuid(),
  meetup_id uuid not null references public.meetups on delete cascade,
  kind text not null check (kind in ('time', 'place')),
  label text check (char_length(label) <= 120),
  starts_at timestamptz,
  position int not null default 0,
  check ((kind = 'time' and starts_at is not null) or (kind = 'place' and label is not null))
);
create index on public.meetup_options (meetup_id);

create table public.meetup_votes (
  option_id uuid not null references public.meetup_options on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  primary key (option_id, user_id)
);

create or replace function public.option_member(o uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.meetup_options where id = o and public.meetup_member(meetup_id));
$$;

alter table public.meetup_options enable row level security;
alter table public.meetup_votes enable row level security;
create policy "members see options" on public.meetup_options for select to authenticated using (public.meetup_member(meetup_id));
create policy "creator adds options" on public.meetup_options for insert to authenticated with check (public.meetup_creator(meetup_id));
create policy "creator removes options" on public.meetup_options for delete to authenticated using (public.meetup_creator(meetup_id));
create policy "members see votes" on public.meetup_votes for select to authenticated using (public.option_member(option_id));
create policy "vote" on public.meetup_votes for insert to authenticated with check (user_id = auth.uid() and public.option_member(option_id));
create policy "unvote" on public.meetup_votes for delete to authenticated using (user_id = auth.uid());

-- ============ ON MY WAY ============
create table public.on_the_way (
  meetup_id uuid not null references public.meetups on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  lat double precision not null,
  lng double precision not null,
  arrived boolean not null default false,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (meetup_id, user_id)
);
alter table public.on_the_way enable row level security;
create policy "members see who's coming" on public.on_the_way for select to authenticated using (public.meetup_member(meetup_id));
create policy "start own" on public.on_the_way for insert to authenticated with check (user_id = auth.uid() and public.meetup_member(meetup_id));
create policy "update own" on public.on_the_way for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "stop own" on public.on_the_way for delete to authenticated using (user_id = auth.uid());

-- ============ ACCESS + LIVE UPDATES ============
grant select, insert, update, delete on
  public.availability, public.meetup_options, public.meetup_votes, public.on_the_way
to authenticated;
grant execute on function public.meetup_member(uuid), public.meetup_creator(uuid), public.option_member(uuid) to authenticated;

alter publication supabase_realtime add table
  public.availability, public.meetup_options, public.meetup_votes, public.on_the_way;
