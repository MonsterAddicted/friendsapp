-- friendsapp update 3: ghost mode, best day finder, split the bill, waves
-- Paste into Supabase > SQL Editor > New query > Run (after 002).

-- ============ GHOST MODE ============
alter table public.profiles add column ghost_until timestamptz;

create or replace function public.location_visible(owner uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select owner = auth.uid() or (
    public.shares_group(owner)
    and exists (
      select 1 from public.profiles
      where id = owner and location_mode <> 'off' and (ghost_until is null or ghost_until < now())
    )
  );
$$;

-- ============ BEST DAY FINDER ============
create table public.free_days (
  group_id uuid not null references public.groups on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  day date not null,
  primary key (group_id, user_id, day)
);
alter table public.free_days enable row level security;
create policy "members see free days" on public.free_days for select to authenticated using (public.is_member(group_id));
create policy "mark own day" on public.free_days for insert to authenticated with check (user_id = auth.uid() and public.is_member(group_id));
create policy "unmark own day" on public.free_days for delete to authenticated using (user_id = auth.uid());

-- ============ SPLIT THE BILL ============
-- A settlement ("Lea paid Jan back") is stored as an expense paid by Lea with one share for Jan.
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups on delete cascade,
  meetup_id uuid references public.meetups on delete set null,
  created_by uuid not null references public.profiles on delete cascade,
  paid_by uuid not null references public.profiles on delete cascade,
  amount_cents int not null check (amount_cents > 0 and amount_cents < 10000000),
  note text check (char_length(note) <= 80),
  is_settlement boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.expenses (group_id);

create table public.expense_shares (
  expense_id uuid not null references public.expenses on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  amount_cents int not null check (amount_cents >= 0),
  primary key (expense_id, user_id)
);

create or replace function public.expense_member(e uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.expenses where id = e and public.is_member(group_id));
$$;
create or replace function public.expense_creator(e uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.expenses where id = e and created_by = auth.uid());
$$;

alter table public.expenses enable row level security;
alter table public.expense_shares enable row level security;
create policy "members see expenses" on public.expenses for select to authenticated using (public.is_member(group_id));
create policy "members add expenses" on public.expenses for insert to authenticated
  with check (created_by = auth.uid() and public.is_member(group_id));
create policy "creator deletes expense" on public.expenses for delete to authenticated using (created_by = auth.uid());
create policy "members see shares" on public.expense_shares for select to authenticated using (public.expense_member(expense_id));
create policy "creator adds shares" on public.expense_shares for insert to authenticated with check (public.expense_creator(expense_id));

-- ============ WAVES ============
create table public.waves (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups on delete cascade,
  from_user uuid not null references public.profiles on delete cascade,
  to_user uuid not null references public.profiles on delete cascade,
  message text not null check (char_length(message) between 1 and 60),
  seen boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.waves (to_user, created_at desc);
alter table public.waves enable row level security;
create policy "see own waves" on public.waves for select to authenticated using (to_user = auth.uid() or from_user = auth.uid());
create policy "send waves" on public.waves for insert to authenticated
  with check (
    from_user = auth.uid() and public.is_member(group_id)
    and exists (select 1 from public.group_members where group_id = waves.group_id and user_id = waves.to_user)
  );
create policy "mark wave seen" on public.waves for update to authenticated using (to_user = auth.uid()) with check (to_user = auth.uid());

-- ============ ACCESS + LIVE UPDATES ============
grant select, insert, update, delete on
  public.free_days, public.expenses, public.expense_shares, public.waves
to authenticated;
grant execute on function public.expense_member(uuid), public.expense_creator(uuid) to authenticated;

alter publication supabase_realtime add table
  public.free_days, public.expenses, public.expense_shares, public.waves;
