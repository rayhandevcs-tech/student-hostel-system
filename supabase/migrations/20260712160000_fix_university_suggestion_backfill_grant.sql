-- Bug: admin_backfill_university_suggestion is only ever called from
-- src/app/api/admin/university-suggestions/route.ts using the service-role
-- client (needed because there's no RLS policy letting even an admin bulk-
-- update other users' profiles rows — see the update-user/route.ts
-- precedent this route follows). A service-role-authenticated Postgres
-- session has no auth.uid() ('sub' claim) at all, so the function's own
-- `auth.uid() and role = 'admin'` check always evaluated false and raised
-- 'admin only' regardless of who actually called the route — the route
-- already verifies the caller is an admin via bearer token before ever
-- reaching this call, so that check was both wrong (broken by design) and
-- redundant here.
--
-- Fix: drop the auth.uid()-based check (it can never pass for this call
-- path) and instead restrict execute to `service_role` only — unlike
-- admin_list_profiles/admin_list_university_suggestions (called directly
-- by an authenticated admin's own client, where auth.uid() correctly
-- resolves and the in-function check is the real gate), this function is
-- never meant to be reachable by an ordinary authenticated client at all,
-- so the grant itself is the gate.
create or replace function public.admin_backfill_university_suggestion(
  p_normalized_text text,
  p_university_id uuid
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count bigint;
begin
  update public.profiles
  set university_id = p_university_id
  where university_id is null
    and lower(trim(university)) = p_normalized_text;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.admin_backfill_university_suggestion(text, uuid) from public;
revoke all on function public.admin_backfill_university_suggestion(text, uuid) from authenticated;
grant execute on function public.admin_backfill_university_suggestion(text, uuid) to service_role;
