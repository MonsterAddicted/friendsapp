-- friendsapp database setup
-- Paste this whole file into Supabase > SQL Editor > New query, then press Run.
-- Safe to run once on a fresh project.

-- ============ TABLES ============

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  username text unique not null check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name text not null check (char_length(display_name) between 1 and 40),
  emoji text not null default '😀',
  color text not null default '#ff7a1a',
  location_mode text not null default 'off' check (location_mode in ('off', 'manual', 'live')),
  created_at timestamptz not null default now()
);

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  invite_code text unique not null,
  created_by uuid not null references public.profiles on delete cascade,
  created_at timestamptz not null default now()
);

create table public.group_members (
  group_id uuid not null references public.groups on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  role text not null default 'member' check (role in ('admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index on public.group_members (user_id);

-- "What are you doing right now?" posts
create table public.statuses (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  emoji text not null default '💬',
  text text not null check (char_length(text) between 1 and 280),
  created_at timestamptz not null default now()
);
create index on public.statuses (group_id, created_at desc);

-- One row per person: their last shared spot
create table public.locations (
  user_id uuid primary key references public.profiles on delete cascade,
  lat double precision not null,
  lng double precision not null,
  accuracy double precision,
  updated_at timestamptz not null default now()
);

create table public.meetups (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups on delete cascade,
  created_by uuid not null references public.profiles on delete cascade,
  kind text not null check (kind in ('party', 'eat', 'sport', 'chill', 'gaming', 'other')),
  title text not null check (char_length(title) between 1 and 80),
  details text check (char_length(details) <= 500),
  place text check (char_length(place) <= 120),
  starts_at timestamptz,
  cancelled boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.meetups (group_id, starts_at);

create table public.meetup_responses (
  meetup_id uuid not null references public.meetups on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  answer text not null check (answer in ('in', 'maybe', 'out')),
  updated_at timestamptz not null default now(),
  primary key (meetup_id, user_id)
);

-- ============ HELPERS ============

create or replace function public.is_member(g uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.group_members where group_id = g and user_id = auth.uid()
  );
$$;

create or replace function public.shares_group(other uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.group_members a
    join public.group_members b on a.group_id = b.group_id
    where a.user_id = auth.uid() and b.user_id = other
  );
$$;

create or replace function public.location_visible(owner uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select owner = auth.uid() or (
    public.shares_group(owner)
    and exists (select 1 from public.profiles where id = owner and location_mode <> 'off')
  );
$$;

-- Create a group with a fresh 6-letter invite code, creator becomes admin
create or replace function public.create_group(group_name text)
returns public.groups language plpgsql security definer set search_path = '' as $$
declare
  g public.groups;
  code text;
  i int;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1);
    end loop;
    exit when not exists (select 1 from public.groups where invite_code = code);
  end loop;
  insert into public.groups (name, invite_code, created_by)
    values (trim(group_name), code, auth.uid()) returning * into g;
  insert into public.group_members (group_id, user_id, role) values (g.id, auth.uid(), 'admin');
  return g;
end;
$$;

-- Join a group by its invite code
create or replace function public.join_group(code text)
returns public.groups language plpgsql security definer set search_path = '' as $$
declare
  g public.groups;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into g from public.groups where invite_code = upper(trim(code));
  if not found then raise exception 'No group with that code'; end if;
  insert into public.group_members (group_id, user_id) values (g.id, auth.uid())
    on conflict do nothing;
  return g;
end;
$$;

revoke execute on function public.create_group(text) from public, anon;
revoke execute on function public.join_group(text) from public, anon;
grant execute on function public.create_group(text) to authenticated;
grant execute on function public.join_group(text) to authenticated;

-- ============ SECURITY RULES (only your groups can see your stuff) ============

alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.statuses enable row level security;
alter table public.locations enable row level security;
alter table public.meetups enable row level security;
alter table public.meetup_responses enable row level security;

create policy "see self and group mates" on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_group(id));
create policy "create own profile" on public.profiles for insert to authenticated
  with check (id = auth.uid());
create policy "edit own profile" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy "members see group" on public.groups for select to authenticated
  using (public.is_member(id));
create policy "admins rename group" on public.groups for update to authenticated
  using (exists (select 1 from public.group_members where group_id = id and user_id = auth.uid() and role = 'admin'));

create policy "members see members" on public.group_members for select to authenticated
  using (public.is_member(group_id));
create policy "leave group" on public.group_members for delete to authenticated
  using (user_id = auth.uid());

create policy "members read statuses" on public.statuses for select to authenticated
  using (public.is_member(group_id));
create policy "members post statuses" on public.statuses for insert to authenticated
  with check (user_id = auth.uid() and public.is_member(group_id));
create policy "delete own status" on public.statuses for delete to authenticated
  using (user_id = auth.uid());

create policy "see shared locations" on public.locations for select to authenticated
  using (public.location_visible(user_id));
create policy "write own location" on public.locations for insert to authenticated
  with check (user_id = auth.uid());
create policy "update own location" on public.locations for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "delete own location" on public.locations for delete to authenticated
  using (user_id = auth.uid());

create policy "members read meetups" on public.meetups for select to authenticated
  using (public.is_member(group_id));
create policy "members create meetups" on public.meetups for insert to authenticated
  with check (created_by = auth.uid() and public.is_member(group_id));
create policy "creator edits meetup" on public.meetups for update to authenticated
  using (created_by = auth.uid()) with check (created_by = auth.uid());

create policy "members read answers" on public.meetup_responses for select to authenticated
  using (exists (select 1 from public.meetups m where m.id = meetup_id and public.is_member(m.group_id)));
create policy "answer meetup" on public.meetup_responses for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.meetups m where m.id = meetup_id and public.is_member(m.group_id)));
create policy "change answer" on public.meetup_responses for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (select 1 from public.meetups m where m.id = meetup_id and public.is_member(m.group_id)));
create policy "remove answer" on public.meetup_responses for delete to authenticated
  using (user_id = auth.uid());

-- Table access for signed-in users (the security rules above still decide which rows)
grant select, insert, update, delete on
  public.profiles, public.groups, public.group_members, public.statuses,
  public.locations, public.meetups, public.meetup_responses
to authenticated;
grant execute on function public.is_member(uuid), public.shares_group(uuid), public.location_visible(uuid) to authenticated;

-- ============ LIVE UPDATES ============

alter publication supabase_realtime add table
  public.statuses, public.locations, public.meetups, public.meetup_responses,
  public.group_members, public.profiles;
