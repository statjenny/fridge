-- 在 Supabase Dashboard 的 SQL Editor 中完整执行一次。
create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now()
);

create table public.fridges (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.fridge_members (
  fridge_id uuid not null references public.fridges(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('admin', 'member')) default 'member',
  joined_at timestamptz not null default now(),
  primary key (fridge_id, user_id)
);

create table public.items (
  id bigint generated always as identity primary key,
  fridge_id uuid not null references public.fridges(id) on delete cascade,
  name text not null,
  category text not null,
  sub_category text not null,
  quantity integer not null check (quantity > 0),
  recorded_on date not null default current_date,
  expiry_date date,
  created_at timestamptz not null default now()
);

create table public.invite_links (
  token uuid primary key default gen_random_uuid(),
  fridge_id uuid not null references public.fridges(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete cascade,
  expires_at timestamptz not null default (now() + interval '7 days'),
  used_by uuid references public.profiles(id) on delete set null,
  used_at timestamptz,
  revoked_at timestamptz
);

alter table public.profiles enable row level security;
alter table public.fridges enable row level security;
alter table public.fridge_members enable row level security;
alter table public.items enable row level security;
alter table public.invite_links enable row level security;

create or replace function public.is_fridge_member(target_fridge uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.fridge_members where fridge_id = target_fridge and user_id = auth.uid());
$$;

create policy "members read fridges" on public.fridges for select using (public.is_fridge_member(id));
create policy "members read items" on public.items for select using (public.is_fridge_member(fridge_id));
create policy "members add items" on public.items for insert with check (public.is_fridge_member(fridge_id));
create policy "members update items" on public.items for update using (public.is_fridge_member(fridge_id));
create policy "members delete items" on public.items for delete using (public.is_fridge_member(fridge_id));
create policy "members read members" on public.fridge_members for select using (public.is_fridge_member(fridge_id));
create policy "users read shared profiles" on public.profiles for select using (
  id = auth.uid() or exists (
    select 1 from public.fridge_members mine join public.fridge_members theirs on mine.fridge_id = theirs.fridge_id
    where mine.user_id = auth.uid() and theirs.user_id = profiles.id
  )
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare new_fridge uuid;
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)));
  insert into public.fridges (name, owner_id) values ('我的冰箱', new.id) returning id into new_fridge;
  insert into public.fridge_members (fridge_id, user_id, role) values (new_fridge, new.id, 'admin');
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

create or replace function public.create_invite(target_fridge uuid, valid_days integer default 7)
returns uuid language plpgsql security definer set search_path = public as $$
declare invite_token uuid;
begin
  if not exists (select 1 from public.fridge_members where fridge_id = target_fridge and user_id = auth.uid() and role = 'admin') then
    raise exception 'Only administrators can create invitations';
  end if;
  insert into public.invite_links (fridge_id, created_by, expires_at)
  values (target_fridge, auth.uid(), now() + make_interval(days => greatest(1, least(valid_days, 30))))
  returning token into invite_token;
  return invite_token;
end;
$$;

create or replace function public.accept_invite(invite_token uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare target_fridge uuid;
begin
  select fridge_id into target_fridge from public.invite_links
  where token = invite_token and used_at is null and revoked_at is null and expires_at > now()
  for update;
  if target_fridge is null then raise exception 'Invite link is invalid, expired, or already used'; end if;
  insert into public.fridge_members (fridge_id, user_id) values (target_fridge, auth.uid()) on conflict do nothing;
  update public.invite_links set used_by = auth.uid(), used_at = now() where token = invite_token;
  return target_fridge;
end;
$$;

grant execute on function public.create_invite(uuid, integer) to authenticated;
grant execute on function public.accept_invite(uuid) to authenticated;
