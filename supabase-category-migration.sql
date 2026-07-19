-- 在 Supabase Dashboard 的 SQL Editor 执行一次。
-- 将旧版“罐头”大类保留为“干货”下的“罐头”小类。
update public.items
set category = '干货', sub_category = '罐头'
where category = '罐头';
