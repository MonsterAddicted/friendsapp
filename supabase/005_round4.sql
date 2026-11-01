-- friendsapp update 5 (round 4): seen by, song status, busy mode, 24 h statuses, battery, SOS,
-- mute & remove, admin tools, favourite spots, ratings, decision wheel, bucket list,
-- birthdays, bio, German push texts, delete account.
-- Paste into Supabase > SQL Editor > New query > Run (after 004).

-- ============ PROFILE ============
alter table public.profiles
  add column busy_until timestamptz,
  add column bio text check (char_length(bio) <= 160),
  add column favs jsonb not null default '{}' check (pg_column_size(favs) < 2000),
  add column birthday date,
  add column birthday_pushed int,
  add column lang text not null default 'en' check (lang in ('en', 'de')),
  add column privacy jsonb not null default '{}' check (pg_column_size(privacy) < 1000);

-- ============ STATUS: song + seen by ============
alter table public.statuses
  add column song_url text check (song_url ~ '^https://open\.spotify\.com/' and char_length(song_url) <= 300),
  add column song_title text check (char_length(song_title) <= 120);

create or replace function public.status_member(s uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.statuses x where x.id = s and public.is_member(x.group_id));
$$;
grant execute on function public.status_member(uuid) to authenticated;

create table public.status_views (
  status_id uuid not null references public.statuses on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (status_id, user_id)
);
alter table public.status_views enable row level security;
create policy "members see views" on public.status_views for select to authenticated using (public.status_member(status_id));
create policy "mark seen" on public.status_views for insert to authenticated with check (user_id = auth.uid() and public.status_member(status_id));
grant select, insert on public.status_views to authenticated;

create table public.meetup_views (
  meetup_id uuid not null references public.meetups on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (meetup_id, user_id)
);
alter table public.meetup_views enable row level security;
create policy "members see meetup views" on public.meetup_views for select to authenticated using (public.meetup_member(meetup_id));
create policy "mark meetup seen" on public.meetup_views for insert to authenticated with check (user_id = auth.uid() and public.meetup_member(meetup_id));
grant select, insert on public.meetup_views to authenticated;

-- ============ BATTERY ============
alter table public.locations
  add column battery smallint check (battery between 0 and 100),
  add column charging boolean;

-- ============ MUTE ============
create table public.mutes (
  user_id uuid not null references public.profiles on delete cascade,
  muted uuid not null references public.profiles on delete cascade,
  primary key (user_id, muted)
);
alter table public.mutes enable row level security;
create policy "own mutes" on public.mutes for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, delete on public.mutes to authenticated;

-- ============ ADMIN TOOLS ============
create or replace function public.is_admin(g uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.group_members where group_id = g and user_id = auth.uid() and role = 'admin');
$$;
grant execute on function public.is_admin(uuid) to authenticated;

create policy "admins remove members" on public.group_members for delete to authenticated using (public.is_admin(group_id));

create or replace function public.new_invite_code(g uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  code text;
  i int;
begin
  if not public.is_admin(g) then raise exception 'Only admins can do that'; end if;
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1);
    end loop;
    exit when not exists (select 1 from public.groups where invite_code = code);
  end loop;
  update public.groups set invite_code = code where id = g;
  return code;
end;
$$;

-- Make someone else admin and step down yourself
create or replace function public.pass_admin(g uuid, u uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin(g) then raise exception 'Only admins can do that'; end if;
  if not exists (select 1 from public.group_members where group_id = g and user_id = u) then raise exception 'Not in this group'; end if;
  update public.group_members set role = 'admin' where group_id = g and user_id = u;
  if u <> auth.uid() then
    update public.group_members set role = 'member' where group_id = g and user_id = auth.uid();
  end if;
end;
$$;
revoke execute on function public.new_invite_code(uuid), public.pass_admin(uuid, uuid) from public, anon;
grant execute on function public.new_invite_code(uuid), public.pass_admin(uuid, uuid) to authenticated;

-- When the last admin leaves, the longest member becomes admin
create or replace function private.keep_an_admin() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'admin' and not exists (select 1 from public.group_members where group_id = old.group_id and role = 'admin') then
    update public.group_members set role = 'admin'
      where group_id = old.group_id
        and user_id = (select user_id from public.group_members where group_id = old.group_id order by joined_at limit 1);
  end if;
  return old;
end;
$$;
create trigger keep_an_admin after delete on public.group_members for each row execute function private.keep_an_admin();

-- ============ SOS ============
create table public.sos_alerts (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  lat double precision,
  lng double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);
alter table public.sos_alerts enable row level security;
create policy "members see sos" on public.sos_alerts for select to authenticated using (public.is_member(group_id));
create policy "send sos" on public.sos_alerts for insert to authenticated with check (user_id = auth.uid() and public.is_member(group_id));
create policy "update own sos" on public.sos_alerts for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update on public.sos_alerts to authenticated;

-- ============ FAVOURITE SPOTS ============
create table public.spots (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups on delete cascade,
  created_by uuid not null references public.profiles on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  emoji text not null default '⭐',
  lat double precision,
  lng double precision,
  created_at timestamptz not null default now()
);
alter table public.spots enable row level security;
create policy "members see spots" on public.spots for select to authenticated using (public.is_member(group_id));
create policy "members add spots" on public.spots for insert to authenticated with check (created_by = auth.uid() and public.is_member(group_id));
create policy "members remove spots" on public.spots for delete to authenticated using (public.is_member(group_id));
grant select, insert, delete on public.spots to authenticated;

-- ============ MEETUP RATINGS ============
create table public.meetup_ratings (
  meetup_id uuid not null references public.meetups on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  stars smallint not null check (stars between 1 and 5),
  primary key (meetup_id, user_id)
);
alter table public.meetup_ratings enable row level security;
create policy "members see ratings" on public.meetup_ratings for select to authenticated using (public.meetup_member(meetup_id));
create policy "rate" on public.meetup_ratings for insert to authenticated with check (user_id = auth.uid() and public.meetup_member(meetup_id));
create policy "change rating" on public.meetup_ratings for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update on public.meetup_ratings to authenticated;

-- ============ DECISION WHEEL ============
create table public.wheel_spins (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  title text not null check (char_length(title) between 1 and 60),
  options text[] not null check (cardinality(options) between 2 and 12),
  result int not null,
  created_at timestamptz not null default now(),
  check (result >= 0 and result < cardinality(options))
);
alter table public.wheel_spins enable row level security;
create policy "members see spins" on public.wheel_spins for select to authenticated using (public.is_member(group_id));
create policy "spin" on public.wheel_spins for insert to authenticated with check (user_id = auth.uid() and public.is_member(group_id));
grant select, insert on public.wheel_spins to authenticated;

-- ============ BUCKET LIST ============
create table public.bucket_items (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups on delete cascade,
  created_by uuid not null references public.profiles on delete cascade,
  title text not null check (char_length(title) between 1 and 60),
  emoji text not null default '✨',
  done_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.bucket_items enable row level security;
create policy "members see bucket" on public.bucket_items for select to authenticated using (public.is_member(group_id));
create policy "members add to bucket" on public.bucket_items for insert to authenticated with check (created_by = auth.uid() and public.is_member(group_id));
create policy "members tick bucket" on public.bucket_items for update to authenticated using (public.is_member(group_id)) with check (public.is_member(group_id));
create policy "remove bucket item" on public.bucket_items for delete to authenticated using (created_by = auth.uid() or public.is_admin(group_id));
grant select, insert, update, delete on public.bucket_items to authenticated;

-- ============ DELETE ACCOUNT ============
-- Groups you created are handed to another member first (or deleted when you're the only one).
create or replace function public.delete_account()
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  g record;
  heir uuid;
begin
  if me is null then raise exception 'Not signed in'; end if;
  for g in select id from public.groups where created_by = me loop
    select user_id into heir from public.group_members
      where group_id = g.id and user_id <> me order by (role = 'admin') desc, joined_at limit 1;
    if heir is null then
      delete from public.groups where id = g.id;
    else
      update public.groups set created_by = heir where id = g.id;
      update public.group_members set role = 'admin' where group_id = g.id and user_id = heir;
    end if;
  end loop;
  delete from auth.users where id = me;
end;
$$;
revoke execute on function public.delete_account() from public, anon;
grant execute on function public.delete_account() to authenticated;

-- ============ PUSH: busy mode + German ============
-- Sends to everyone in `users` whose settings allow `kind` and who isn't busy (SOS always goes through).
-- German speakers get title_de/body_de when given.
create or replace function private.send(subs jsonb, kind text, title text, body text, link text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  push_url text;
  secret text;
begin
  if subs is null or jsonb_array_length(subs) = 0 then return; end if;
  select value into push_url from private.config where key = 'push_url';
  select value into secret from private.config where key = 'push_secret';
  if push_url is null or secret is null then return; end if;
  perform net.http_post(
    url := push_url,
    body := jsonb_build_object('subscriptions', subs, 'title', title, 'body', body, 'url', link, 'tag', kind),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', secret)
  );
end;
$$;

create or replace function private.push2(users uuid[], kind text, title text, body text, link text, title_de text, body_de text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  l text;
  subs jsonb;
begin
  foreach l in array array['en', 'de'] loop
    select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'keys', jsonb_build_object('p256dh', s.p256dh, 'auth', s.auth)))
      into subs
    from public.push_subscriptions s
    join public.profiles p on p.id = s.user_id
    where s.user_id = any(users)
      and (case when l = 'de' then p.lang = 'de' else p.lang <> 'de' end)
      and (kind = 'sos' or (
        coalesce((p.notify ->> kind)::boolean, true)
        and (p.busy_until is null or p.busy_until < now())
      ));
    if l = 'de' then
      perform private.send(subs, kind, coalesce(title_de, title), coalesce(body_de, body), link);
    else
      perform private.send(subs, kind, title, body, link);
    end if;
  end loop;
end;
$$;

-- The old 5-argument version keeps working (English only) and now respects busy mode too.
create or replace function private.push(users uuid[], kind text, title text, body text, link text default '/')
returns void language sql security definer set search_path = '' as $$
  select private.push2(users, kind, title, body, link, null, null);
$$;

-- German texts for the existing notifications
create or replace function private.on_wave() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.push2(array[new.to_user], 'waves',
    private.name_of(new.from_user) || ' waved 👋', new.message, '/',
    private.name_of(new.from_user) || ' winkt dir 👋', new.message);
  return new;
end;
$$;

create or replace function private.on_meetup() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  members uuid[];
begin
  select coalesce(array_agg(user_id), '{}') into members from public.group_members
    where group_id = new.group_id and user_id <> new.created_by;
  perform private.push2(members, 'meetups',
    private.name_of(new.created_by) || ': ' || new.title, 'Tap to answer: I''m in, Maybe or Can''t', '/?tab=meetups',
    private.name_of(new.created_by) || ': ' || new.title, 'Tippe zum Antworten: Bin dabei, Vielleicht oder Kann nicht');
  return new;
end;
$$;

create or replace function private.on_free() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.until > now() then return new; end if;
  perform private.push2(private.mates(new.user_id), 'free',
    private.name_of(new.user_id) || ' is free 🙋', coalesce(new.note, 'Up for: ' || new.up_for) || '. Free too? Tap to start something.', '/?tab=feed',
    private.name_of(new.user_id) || ' hat Zeit 🙋', coalesce(new.note || '. ', '') || 'Du auch? Tippe, um was zu starten.');
  return new;
end;
$$;

create or replace function private.on_location() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  other record;
begin
  select * into me from public.profiles where id = new.user_id;
  if me.location_mode <> 'live' or (me.ghost_until is not null and me.ghost_until > now()) then return new; end if;
  for other in
    select l.user_id, l.lat, l.lng from public.locations l
    join public.profiles p on p.id = l.user_id
    where l.user_id = any(private.mates(new.user_id))
      and p.location_mode = 'live' and (p.ghost_until is null or p.ghost_until < now())
      and l.updated_at > now() - interval '15 minutes'
      and private.km(new.lat, new.lng, l.lat, l.lng) < 0.3
  loop
    if not exists (
      select 1 from private.nearby_log
      where at > now() - interval '6 hours'
        and ((a = new.user_id and b = other.user_id) or (a = other.user_id and b = new.user_id))
    ) then
      insert into private.nearby_log (a, b) values (new.user_id, other.user_id);
      perform private.push2(array[other.user_id], 'nearby', me.display_name || ' is nearby 📍', 'Less than 300 m from you. Say hi?', '/?tab=map',
        me.display_name || ' ist in der Nähe 📍', 'Weniger als 300 m entfernt. Sag hallo!');
      perform private.push2(array[new.user_id], 'nearby', private.name_of(other.user_id) || ' is nearby 📍', 'Less than 300 m from you. Say hi?', '/?tab=map',
        private.name_of(other.user_id) || ' ist in der Nähe 📍', 'Weniger als 300 m entfernt. Sag hallo!');
    end if;
  end loop;
  return new;
end;
$$;

-- SOS goes to everyone in the group, even when busy or notifications are switched off
create or replace function private.on_sos() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  members uuid[];
begin
  select coalesce(array_agg(user_id), '{}') into members from public.group_members
    where group_id = new.group_id and user_id <> new.user_id;
  perform private.push2(members, 'sos',
    '🆘 ' || private.name_of(new.user_id) || ' needs help', 'Tap to see where they are.', '/?tab=map',
    '🆘 ' || private.name_of(new.user_id) || ' braucht Hilfe', 'Tippe, um zu sehen, wo.');
  return new;
end;
$$;
create trigger push_sos after insert on public.sos_alerts for each row execute function private.on_sos();

-- ============ SCHEDULED (replaces the version from update 4) ============
create or replace function private.tick() returns void language plpgsql security definer set search_path = '' as $$
declare
  m record;
  u record;
  tz text;
  local_now timestamp;
  mins int;
begin
  -- Meetup reminders (~1 hour before)
  for m in
    select * from public.meetups
    where not cancelled and not reminder_sent
      and starts_at > now() + interval '15 minutes' and starts_at <= now() + interval '60 minutes'
  loop
    update public.meetups set reminder_sent = true where id = m.id;
    mins := greatest(1, round(extract(epoch from (m.starts_at - now())) / 60))::int;
    perform private.push2(
      (select coalesce(array_agg(user_id), '{}') from public.meetup_responses where meetup_id = m.id and answer in ('in', 'maybe')),
      'reminders',
      m.title || ' in ' || mins || ' min ⏰',
      coalesce('At ' || m.place || '. ', '') || 'Tap "I''m on my way" when you leave.',
      '/?tab=meetups',
      m.title || ' in ' || mins || ' Min ⏰',
      coalesce('Ort: ' || m.place || '. ', '') || 'Tippe auf „Bin unterwegs“, wenn du losgehst.'
    );
  end loop;

  -- Daily "what are you doing?" nudge at a random time between 10:00 and 21:00 local time
  for u in
    select p.id, p.timezone, p.next_nudge_at from public.profiles p
    where coalesce((p.notify ->> 'nudge')::boolean, true)
      and exists (select 1 from public.push_subscriptions s where s.user_id = p.id)
      and (p.next_nudge_at is null or p.next_nudge_at <= now())
  loop
    tz := coalesce(nullif(u.timezone, ''), 'Europe/Berlin');
    if u.next_nudge_at is not null then
      perform private.push2(array[u.id], 'nudge', 'What are you doing right now? 👀', 'Tell your friends in one tap.', '/?tab=feed',
        'Was machst du gerade? 👀', 'Sag es deinen Freunden mit einem Tipp.');
    end if;
    update public.profiles
      set next_nudge_at = (((now() at time zone tz)::date + 1) + interval '10 hours' + random() * interval '11 hours') at time zone tz
      where id = u.id;
  end loop;

  -- Birthdays: at 9:00 local time on the day
  for u in select p.id, p.timezone, p.birthday from public.profiles p where p.birthday is not null loop
    tz := coalesce(nullif(u.timezone, ''), 'Europe/Berlin');
    local_now := now() at time zone tz;
    if extract(month from local_now) = extract(month from u.birthday)
       and extract(day from local_now) = extract(day from u.birthday)
       and extract(hour from local_now) >= 9
       and coalesce((select birthday_pushed from public.profiles where id = u.id), 0) < extract(year from local_now) then
      update public.profiles set birthday_pushed = extract(year from local_now) where id = u.id;
      perform private.push2(private.mates(u.id), 'birthdays',
        '🎂 It''s ' || private.name_of(u.id) || '''s birthday!', 'Send a wave to say happy birthday.', '/?tab=feed',
        '🎂 ' || private.name_of(u.id) || ' hat heute Geburtstag!', 'Schick einen Wink und gratuliere.');
      perform private.push2(array[u.id], 'birthdays', '🎂 Happy birthday!', 'Your friends have been told. Enjoy your day!', '/?tab=feed',
        '🎂 Alles Gute zum Geburtstag!', 'Deine Freunde wissen Bescheid. Genieß deinen Tag!');
    end if;
  end loop;

  -- Forget devices that the push service says are gone
  delete from public.push_subscriptions where endpoint in (
    select jsonb_array_elements_text((r.content::jsonb) -> 'gone')
    from net._http_response r
    where r.created > now() - interval '30 minutes' and r.status_code = 200 and r.content like '{"gone":%'
  );
  delete from private.nearby_log where at < now() - interval '1 day';

  -- Statuses only live for 24 hours
  delete from public.statuses where created_at < now() - interval '24 hours';
  -- Old SOS alerts end by themselves after 3 hours
  update public.sos_alerts set resolved_at = now() where resolved_at is null and updated_at < now() - interval '3 hours';
end;
$$;

-- ============ LIVE UPDATES ============
alter publication supabase_realtime add table
  public.status_views, public.meetup_views, public.sos_alerts, public.spots,
  public.meetup_ratings, public.wheel_spins, public.bucket_items;
