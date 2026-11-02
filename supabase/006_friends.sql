-- friendsapp update 6: friends.
-- Friend requests, Add nearby (both people at once), personal QR code, search by exact @username,
-- "people you may know", and inviting a friend into a group (they say yes or no).
-- Friends see each other's profile (name, bio, birthday) but NOT each other's location: that stays in groups.
-- Paste into Supabase > SQL Editor > New query > Run (after 005).

-- ============ FRIENDSHIPS ============
-- One row per pair. a < b so a pair can only exist once.
create table public.friendships (
  a uuid not null references public.profiles on delete cascade,
  b uuid not null references public.profiles on delete cascade,
  requested_by uuid not null references public.profiles on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  primary key (a, b),
  check (a < b),
  check (requested_by in (a, b))
);
create index friendships_b on public.friendships (b);
alter table public.friendships enable row level security;
create policy "see own friendships" on public.friendships for select to authenticated using (auth.uid() in (a, b));
-- Deleting = decline a request, cancel your own request, or remove a friend.
create policy "end own friendships" on public.friendships for delete to authenticated using (auth.uid() in (a, b));
grant select, delete on public.friendships to authenticated;
-- New requests and accepting only go through add_friend() below.

create or replace function public.is_friend(other uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.friendships
    where a = least(auth.uid(), other) and b = greatest(auth.uid(), other) and status = 'accepted'
  );
$$;
grant execute on function public.is_friend(uuid) to authenticated;

-- Profiles: you also see your friends (only after they accepted, so a request alone shows nothing).
drop policy if exists "see self and group mates" on public.profiles;
create policy "see self, group mates and friends" on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_group(id) or public.is_friend(id));

-- The small public card (no bio, birthday or anything else) used for requests, search and Add nearby.
create or replace function private.card(u uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', id, 'username', username, 'display_name', display_name, 'emoji', emoji, 'color', color)
  from public.profiles where id = u;
$$;

create or replace function private.findable(u uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select (privacy ->> 'findable')::boolean from public.profiles where id = u), true);
$$;

-- Everything for the Friends screen in one call: friends, requests in and out.
create or replace function public.my_friends()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(
    private.card(case when f.a = auth.uid() then f.b else f.a end) || jsonb_build_object(
      'state', case when f.status = 'accepted' then 'friend' when f.requested_by = auth.uid() then 'outgoing' else 'incoming' end,
      'since', coalesce(f.accepted_at, f.created_at)
    ) order by coalesce(f.accepted_at, f.created_at) desc
  ), '[]')
  from public.friendships f
  where auth.uid() in (f.a, f.b);
$$;
grant execute on function public.my_friends() to authenticated;

-- Send a request. If they already asked you, this accepts it. Returns 'pending' or 'friends'.
create or replace function public.add_friend(other uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  f public.friendships;
begin
  if me is null then raise exception 'Not signed in'; end if;
  if other = me then raise exception 'That''s you 🙂'; end if;
  if not exists (select 1 from public.profiles where id = other) then raise exception 'Person not found'; end if;
  select * into f from public.friendships where a = least(me, other) and b = greatest(me, other);
  if found then
    if f.status = 'accepted' then return 'friends'; end if;
    if f.requested_by = me then return 'pending'; end if;
    update public.friendships set status = 'accepted', accepted_at = now() where a = f.a and b = f.b;
    return 'friends';
  end if;
  if (select count(*) from public.friendships where requested_by = me and created_at > now() - interval '1 day') >= 30 then
    raise exception 'Too many friend requests today. Try again tomorrow.';
  end if;
  insert into public.friendships (a, b, requested_by) values (least(me, other), greatest(me, other), me);
  return 'pending';
end;
$$;
revoke execute on function public.add_friend(uuid) from public, anon;
grant execute on function public.add_friend(uuid) to authenticated;

-- A card by id: used by personal QR links (/?add=<id>). Ids can't be guessed, so this works even when not findable.
create or replace function public.profile_card(u uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when auth.uid() is null then null else private.card(u) end;
$$;
revoke execute on function public.profile_card(uuid) from public, anon;
grant execute on function public.profile_card(uuid) to authenticated;

-- Search: only the exact @username, and only people who allow it. No partial matches, so nobody can browse users.
create or replace function public.find_user(q text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select private.card(p.id) from public.profiles p
  where auth.uid() is not null
    and lower(p.username) = lower(trim(leading '@' from trim(q)))
    and p.id <> auth.uid()
    and private.findable(p.id)
  limit 1;
$$;
revoke execute on function public.find_user(text) from public, anon;
grant execute on function public.find_user(text) to authenticated;

-- People you may know: people in your groups, then friends of your friends (only if they're findable).
create or replace function public.friend_suggestions()
returns jsonb language sql stable security definer set search_path = '' as $$
  with me as (select auth.uid() as id),
  known as (
    select case when f.a = me.id then f.b else f.a end as id from public.friendships f, me where me.id in (f.a, f.b)
  ),
  myfriends as (
    select case when f.a = me.id then f.b else f.a end as id from public.friendships f, me
    where me.id in (f.a, f.b) and f.status = 'accepted'
  ),
  mates as (
    select gm2.user_id as id, min(g.name) as via
    from public.group_members gm1
    join public.group_members gm2 on gm2.group_id = gm1.group_id
    join public.groups g on g.id = gm1.group_id, me
    where gm1.user_id = me.id and gm2.user_id <> me.id
    group by gm2.user_id
  ),
  fof as (
    select case when f.a = mf.id then f.b else f.a end as id, count(*) as mutual
    from public.friendships f join myfriends mf on mf.id in (f.a, f.b)
    where f.status = 'accepted'
    group by 1
  ),
  pool as (
    select coalesce(m.id, x.id) as id, m.via, coalesce(x.mutual, 0) as mutual
    from mates m full join fof x on x.id = m.id
  )
  select coalesce(jsonb_agg(private.card(p.id) || jsonb_build_object('via', p.via, 'mutual', p.mutual)
    order by (p.via is not null) desc, p.mutual desc), '[]')
  from (
    select pool.* from pool, me
    where pool.id <> me.id
      and pool.id not in (select id from known)
      and (pool.via is not null or private.findable(pool.id))
    order by (pool.via is not null) desc, pool.mutual desc
    limit 20
  ) p;
$$;
revoke execute on function public.friend_suggestions() from public, anon;
grant execute on function public.friend_suggestions() to authenticated;

-- ============ ADD NEARBY ============
-- Only people who have "Add nearby" open at the same moment see each other. Each ping lasts 20 seconds.
create table private.add_nearby (
  user_id uuid primary key references public.profiles on delete cascade,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  acc real,
  expires_at timestamptz not null
);

create or replace function public.nearby_ping(lat double precision, lng double precision, acc real default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  result jsonb;
begin
  if me is null then raise exception 'Not signed in'; end if;
  delete from private.add_nearby where expires_at < now();
  insert into private.add_nearby (user_id, lat, lng, acc, expires_at)
    values (me, nearby_ping.lat, nearby_ping.lng, nearby_ping.acc, now() + interval '20 seconds')
    on conflict (user_id) do update set lat = excluded.lat, lng = excluded.lng, acc = excluded.acc, expires_at = excluded.expires_at;

  select coalesce(jsonb_agg(private.card(x.user_id) || jsonb_build_object('meters', round(x.d)) order by x.d), '[]') into result
  from (
    select o.user_id,
      6371000 * 2 * asin(sqrt(
        power(sin(radians(o.lat - nearby_ping.lat) / 2), 2)
        + cos(radians(nearby_ping.lat)) * cos(radians(o.lat)) * power(sin(radians(o.lng - nearby_ping.lng) / 2), 2)
      )) as d,
      -- Indoors GPS is rough, so allow for both phones' accuracy (at least 100 m, at most 500 m)
      least(500, greatest(100, coalesce(nearby_ping.acc, 0) + coalesce(o.acc, 0))) as radius
    from private.add_nearby o
    where o.user_id <> me and o.expires_at > now()
  ) x
  where x.d <= x.radius;
  return result;
end;
$$;
revoke execute on function public.nearby_ping(double precision, double precision, real) from public, anon;
grant execute on function public.nearby_ping(double precision, double precision, real) to authenticated;

create or replace function public.nearby_stop()
returns void language sql security definer set search_path = '' as $$
  delete from private.add_nearby where user_id = auth.uid();
$$;
revoke execute on function public.nearby_stop() from public, anon;
grant execute on function public.nearby_stop() to authenticated;

-- ============ INVITE A FRIEND INTO A GROUP ============
-- They get asked first (their location would be shared with the group), nobody is added without saying yes.
create table public.group_invites (
  group_id uuid not null references public.groups on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  invited_by uuid not null references public.profiles on delete cascade,
  created_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
alter table public.group_invites enable row level security;
create policy "see own invites" on public.group_invites for select to authenticated using (auth.uid() in (user_id, invited_by));
create policy "drop own invites" on public.group_invites for delete to authenticated using (auth.uid() in (user_id, invited_by));
grant select, delete on public.group_invites to authenticated;

create or replace function public.invite_friend(g uuid, other uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_member(g) then raise exception 'You''re not in that group'; end if;
  if not public.is_friend(other) then raise exception 'You can only invite friends'; end if;
  if exists (select 1 from public.group_members where group_id = g and user_id = other) then
    raise exception 'Already in that group';
  end if;
  insert into public.group_invites (group_id, user_id, invited_by) values (g, other, auth.uid())
    on conflict (group_id, user_id) do nothing;
end;
$$;
revoke execute on function public.invite_friend(uuid, uuid) from public, anon;
grant execute on function public.invite_friend(uuid, uuid) to authenticated;

create or replace function public.my_group_invites()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'group_id', i.group_id, 'group_name', g.name, 'invited_by', private.card(i.invited_by),
    'members', (select count(*) from public.group_members m where m.group_id = i.group_id),
    'created_at', i.created_at
  ) order by i.created_at desc), '[]')
  from public.group_invites i join public.groups g on g.id = i.group_id
  where i.user_id = auth.uid();
$$;
grant execute on function public.my_group_invites() to authenticated;

-- yes = join the group. Either way the invite is gone afterwards.
create or replace function public.answer_group_invite(g uuid, yes boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.group_invites where group_id = g and user_id = auth.uid()) then
    raise exception 'That invite is gone';
  end if;
  if yes then
    insert into public.group_members (group_id, user_id) values (g, auth.uid()) on conflict do nothing;
  end if;
  delete from public.group_invites where group_id = g and user_id = auth.uid();
end;
$$;
revoke execute on function public.answer_group_invite(uuid, boolean) from public, anon;
grant execute on function public.answer_group_invite(uuid, boolean) to authenticated;

-- ============ PUSH ============
create or replace function private.on_friendship() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  other uuid := case when new.requested_by = new.a then new.b else new.a end;
begin
  if tg_op = 'INSERT' then
    perform private.push2(array[other], 'friends',
      private.name_of(new.requested_by) || ' wants to be friends 🤝', 'Tap to say yes or no.', '/?tab=me&friends=1',
      private.name_of(new.requested_by) || ' möchte mit dir befreundet sein 🤝', 'Tippe, um Ja oder Nein zu sagen.');
  elsif new.status = 'accepted' and old.status = 'pending' then
    perform private.push2(array[new.requested_by], 'friends',
      'You and ' || private.name_of(other) || ' are now friends 🎉', 'Now you can invite each other to groups.', '/?tab=me&friends=1',
      private.name_of(other) || ' und du seid jetzt Freunde 🎉', 'Ab jetzt könnt ihr euch in Gruppen einladen.');
  end if;
  return new;
end;
$$;
create trigger friendship_push after insert or update on public.friendships
  for each row execute function private.on_friendship();

create or replace function private.on_group_invite() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  gname text := (select name from public.groups where id = new.group_id);
begin
  perform private.push2(array[new.user_id], 'friends',
    private.name_of(new.invited_by) || ' invited you to ' || gname, 'Tap to join or say no.', '/?tab=me&friends=1',
    private.name_of(new.invited_by) || ' lädt dich in ' || gname || ' ein', 'Tippe zum Beitreten oder Ablehnen.');
  return new;
end;
$$;
create trigger group_invite_push after insert on public.group_invites
  for each row execute function private.on_group_invite();

-- ============ LIVE UPDATES ============
alter publication supabase_realtime add table public.friendships, public.group_invites;
