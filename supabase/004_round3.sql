-- friendsapp update 4: push notifications, reminders, daily nudge, who brings what,
-- countdowns, nearby alert, late tracker.
-- Paste into Supabase > SQL Editor > New query > Run (after 003).
-- The push address + secret are set separately (see 005_push_config, made per install).

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- ============ SETTINGS ============
alter table public.profiles
  add column timezone text,
  add column notify jsonb not null default '{"waves":true,"meetups":true,"free":true,"reminders":true,"nudge":true,"nearby":true}',
  add column next_nudge_at timestamptz;

alter table public.groups
  add column country text check (country ~ '^[A-Z]{2}$'),
  add column subdivision text check (char_length(subdivision) <= 12);

alter table public.meetups add column reminder_sent boolean not null default false;

-- Private settings (push address + secret). Not reachable from the app.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table private.config (key text primary key, value text not null);
create table private.nearby_log (a uuid not null, b uuid not null, at timestamptz not null default now());

-- ============ PUSH SUBSCRIPTIONS ============
create table public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references public.profiles on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
create policy "see own devices" on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
create policy "remove own devices" on public.push_subscriptions for delete to authenticated using (user_id = auth.uid());
grant select, delete on public.push_subscriptions to authenticated;

-- A device can switch accounts, so saving always moves the endpoint to the current user.
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth)
    values (p_endpoint, auth.uid(), p_p256dh, p_auth)
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth;
end;
$$;
revoke execute on function public.save_push_subscription(text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text) to authenticated;

-- ============ SENDING ============
-- Sends one notification to these users (only devices whose owner has `kind` turned on).
create or replace function private.push(users uuid[], kind text, title text, body text, link text default '/')
returns void language plpgsql security definer set search_path = '' as $$
declare
  subs jsonb;
  push_url text;
  secret text;
begin
  select value into push_url from private.config where key = 'push_url';
  select value into secret from private.config where key = 'push_secret';
  if push_url is null or secret is null then return; end if;
  select coalesce(jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'keys', jsonb_build_object('p256dh', s.p256dh, 'auth', s.auth))), '[]'::jsonb)
    into subs
  from public.push_subscriptions s
  join public.profiles p on p.id = s.user_id
  where s.user_id = any(users) and coalesce((p.notify ->> kind)::boolean, true);
  if jsonb_array_length(subs) = 0 then return; end if;
  perform net.http_post(
    url := push_url,
    body := jsonb_build_object('subscriptions', subs, 'title', title, 'body', body, 'url', link, 'tag', kind),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', secret)
  );
end;
$$;

create or replace function private.name_of(u uuid) returns text language sql stable security definer set search_path = '' as $$
  select display_name from public.profiles where id = u;
$$;

create or replace function private.mates(u uuid) returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct b.user_id), '{}')
  from public.group_members a join public.group_members b on a.group_id = b.group_id
  where a.user_id = u and b.user_id <> u;
$$;

-- Waves
create or replace function private.on_wave() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.push(array[new.to_user], 'waves', private.name_of(new.from_user) || ' waved 👋', new.message, '/');
  return new;
end;
$$;
create trigger push_wave after insert on public.waves for each row execute function private.on_wave();

-- New meetups
create or replace function private.on_meetup() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  members uuid[];
begin
  select coalesce(array_agg(user_id), '{}') into members from public.group_members
    where group_id = new.group_id and user_id <> new.created_by;
  perform private.push(members, 'meetups', private.name_of(new.created_by) || ': ' || new.title, 'Tap to answer: I''m in, Maybe or Can''t', '/?tab=meetups');
  return new;
end;
$$;
create trigger push_meetup after insert on public.meetups for each row execute function private.on_meetup();

-- Someone became free
create or replace function private.on_free() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.until > now() then return new; end if; -- was already free
  perform private.push(private.mates(new.user_id), 'free', private.name_of(new.user_id) || ' is free 🙋',
    coalesce(new.note, 'Up for: ' || new.up_for) || '. Free too? Tap to start something.', '/?tab=feed');
  return new;
end;
$$;
create trigger push_free after insert or update of until on public.availability for each row execute function private.on_free();

-- ============ LATE TRACKER ============
create table public.meetup_checkins (
  meetup_id uuid not null references public.meetups on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  arrived_at timestamptz not null default now(),
  primary key (meetup_id, user_id)
);
alter table public.meetup_checkins enable row level security;
create policy "members see check-ins" on public.meetup_checkins for select to authenticated using (public.meetup_member(meetup_id));
create policy "check in" on public.meetup_checkins for insert to authenticated with check (user_id = auth.uid() and public.meetup_member(meetup_id));
create policy "undo check-in" on public.meetup_checkins for delete to authenticated using (user_id = auth.uid());
grant select, insert, delete on public.meetup_checkins to authenticated;

-- Arriving via "On my way" counts as checking in
create or replace function private.on_arrived() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.arrived and not coalesce(old.arrived, false) then
    insert into public.meetup_checkins (meetup_id, user_id) values (new.meetup_id, new.user_id) on conflict do nothing;
  end if;
  return new;
end;
$$;
create trigger checkin_on_arrival after update of arrived on public.on_the_way for each row execute function private.on_arrived();

-- ============ NEARBY ALERT ============
create or replace function private.km(lat1 float8, lng1 float8, lat2 float8, lng2 float8) returns float8 language sql immutable as $$
  select 12742 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ));
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
      perform private.push(array[other.user_id], 'nearby', me.display_name || ' is nearby 📍', 'Less than 300 m from you. Say hi?', '/?tab=map');
      perform private.push(array[new.user_id], 'nearby', private.name_of(other.user_id) || ' is nearby 📍', 'Less than 300 m from you. Say hi?', '/?tab=map');
    end if;
  end loop;
  return new;
end;
$$;
create trigger push_nearby after insert or update on public.locations for each row execute function private.on_location();

-- ============ WHO BRINGS WHAT ============
create table public.meetup_items (
  id uuid primary key default gen_random_uuid(),
  meetup_id uuid not null references public.meetups on delete cascade,
  label text not null check (char_length(label) between 1 and 40),
  created_by uuid not null references public.profiles on delete cascade,
  claimed_by uuid references public.profiles on delete set null,
  created_at timestamptz not null default now()
);
alter table public.meetup_items enable row level security;
create policy "members see items" on public.meetup_items for select to authenticated using (public.meetup_member(meetup_id));
create policy "members add items" on public.meetup_items for insert to authenticated with check (created_by = auth.uid() and public.meetup_member(meetup_id));
create policy "members claim items" on public.meetup_items for update to authenticated
  using (public.meetup_member(meetup_id) and (claimed_by is null or claimed_by = auth.uid()))
  with check (public.meetup_member(meetup_id) and (claimed_by is null or claimed_by = auth.uid()));
create policy "remove own items" on public.meetup_items for delete to authenticated
  using (created_by = auth.uid() or public.meetup_creator(meetup_id));
grant select, insert, update, delete on public.meetup_items to authenticated;

-- ============ COUNTDOWNS ============
create table public.countdowns (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups on delete cascade,
  created_by uuid not null references public.profiles on delete cascade,
  title text not null check (char_length(title) between 1 and 40),
  emoji text not null default '⏳',
  day date not null,
  created_at timestamptz not null default now()
);
alter table public.countdowns enable row level security;
create policy "members see countdowns" on public.countdowns for select to authenticated using (public.is_member(group_id));
create policy "members add countdowns" on public.countdowns for insert to authenticated with check (created_by = auth.uid() and public.is_member(group_id));
create policy "remove own countdowns" on public.countdowns for delete to authenticated using (created_by = auth.uid());
grant select, insert, delete on public.countdowns to authenticated;

-- ============ SCHEDULED: reminders, daily nudge, cleanup ============
create or replace function private.tick() returns void language plpgsql security definer set search_path = '' as $$
declare
  m record;
  u record;
  tz text;
begin
  -- Meetup reminders (~1 hour before)
  for m in
    select * from public.meetups
    where not cancelled and not reminder_sent
      and starts_at > now() + interval '15 minutes' and starts_at <= now() + interval '60 minutes'
  loop
    update public.meetups set reminder_sent = true where id = m.id;
    perform private.push(
      (select coalesce(array_agg(user_id), '{}') from public.meetup_responses where meetup_id = m.id and answer in ('in', 'maybe')),
      'reminders',
      m.title || ' in ' || greatest(1, round(extract(epoch from (m.starts_at - now())) / 60))::int || ' min ⏰',
      coalesce('At ' || m.place || '. ', '') || 'Tap "I''m on my way" when you leave.',
      '/?tab=meetups'
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
      perform private.push(array[u.id], 'nudge', 'What are you doing right now? 👀', 'Tell your friends in one tap.', '/?tab=feed');
    end if;
    update public.profiles
      set next_nudge_at = (((now() at time zone tz)::date + 1) + interval '10 hours' + random() * interval '11 hours') at time zone tz
      where id = u.id;
  end loop;

  -- Forget devices that the push service says are gone
  delete from public.push_subscriptions where endpoint in (
    select jsonb_array_elements_text((r.content::jsonb) -> 'gone')
    from net._http_response r
    where r.created > now() - interval '30 minutes' and r.status_code = 200 and r.content like '{"gone":%'
  );
  delete from private.nearby_log where at < now() - interval '1 day';
end;
$$;

select cron.schedule('friendsapp-tick', '*/5 * * * *', 'select private.tick()');

-- ============ LIVE UPDATES ============
alter publication supabase_realtime add table public.meetup_checkins, public.meetup_items, public.countdowns;
