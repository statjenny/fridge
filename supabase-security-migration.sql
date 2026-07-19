-- 已执行初始 supabase-schema.sql 的项目，请在 Supabase SQL Editor 再执行一次此文件。
-- 收紧 SECURITY DEFINER 函数的执行权限，并防止可变 search_path 影响函数解析。

alter function public.is_fridge_member(uuid) set search_path = '';
alter function public.handle_new_user() set search_path = '';
alter function public.create_invite(uuid, integer) set search_path = '';
alter function public.accept_invite(uuid) set search_path = '';

revoke execute on function public.is_fridge_member(uuid) from public;
revoke execute on function public.create_invite(uuid, integer) from public;
revoke execute on function public.accept_invite(uuid) from public;
revoke execute on function public.handle_new_user() from public;

grant execute on function public.is_fridge_member(uuid) to authenticated;
grant execute on function public.create_invite(uuid, integer) to authenticated;
grant execute on function public.accept_invite(uuid) to authenticated;
