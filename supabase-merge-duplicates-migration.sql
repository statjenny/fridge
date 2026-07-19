-- 在 Supabase Dashboard 的 SQL Editor 执行一次。
-- 1. 合并同一冰箱、同一大类、同一小类、同名物品的现有重复数据。
-- 2. 以后通过 save_or_merge_item 原子保存，自动将重复项数量相加。

with groups as (
  select fridge_id, category, sub_category, name,
         min(id) as keep_id,
         sum(quantity) as total_quantity,
         min(recorded_on) as first_recorded_on,
         min(expiry_date) as earliest_expiry_date
  from public.items
  group by fridge_id, category, sub_category, name
  having count(*) > 1
)
update public.items item
set quantity = groups.total_quantity,
    recorded_on = groups.first_recorded_on,
    expiry_date = groups.earliest_expiry_date
from groups
where item.id = groups.keep_id;

delete from public.items item
using (
  select id, row_number() over (
    partition by fridge_id, category, sub_category, name order by id
  ) as position
  from public.items
) duplicates
where item.id = duplicates.id and duplicates.position > 1;

alter table public.items
  add constraint items_unique_name_per_category
  unique (fridge_id, category, sub_category, name);

create or replace function public.save_or_merge_item(
  p_item_id bigint,
  p_fridge_id uuid,
  p_name text,
  p_category text,
  p_sub_category text,
  p_quantity integer,
  p_recorded_on date,
  p_expiry_date date
)
returns bigint language plpgsql security definer set search_path = '' as $$
declare saved_item_id bigint;
begin
  if auth.uid() is null or not public.is_fridge_member(p_fridge_id) then
    raise exception 'You do not have permission to change this fridge';
  end if;

  if p_quantity < 1 or char_length(trim(p_name)) = 0 then
    raise exception 'Item name and quantity are invalid';
  end if;

  if p_item_id is not null then
    delete from public.items
    where id = p_item_id and fridge_id = p_fridge_id
    returning id into saved_item_id;
    if saved_item_id is null then raise exception 'Item not found'; end if;
  end if;

  insert into public.items (fridge_id, name, category, sub_category, quantity, recorded_on, expiry_date)
  values (p_fridge_id, trim(p_name), p_category, p_sub_category, p_quantity, p_recorded_on, p_expiry_date)
  on conflict (fridge_id, category, sub_category, name) do update
  set quantity = public.items.quantity + excluded.quantity,
      recorded_on = least(public.items.recorded_on, excluded.recorded_on),
      expiry_date = case
        when public.items.expiry_date is null then excluded.expiry_date
        when excluded.expiry_date is null then public.items.expiry_date
        else least(public.items.expiry_date, excluded.expiry_date)
      end
  returning id into saved_item_id;

  return saved_item_id;
end;
$$;

revoke execute on function public.save_or_merge_item(bigint, uuid, text, text, text, integer, date, date) from public;
grant execute on function public.save_or_merge_item(bigint, uuid, text, text, text, integer, date, date) to authenticated;
