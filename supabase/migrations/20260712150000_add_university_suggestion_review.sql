-- Problem: profiles.university_id stays null whenever a student's typed
-- university text doesn't match anything in the curated `universities`
-- table, but the raw text is still saved in profiles.university — sitting
-- there unused. This adds an admin-reviewable queue over that data: group
-- unmatched free text, let an admin approve a group into a real
-- `universities` row (backfilling university_id on the matching profiles),
-- or dismiss obvious junk (reversibly).
--
-- university_suggestion_dismissals is a ledger, not a soft-delete flag —
-- the "queue" itself is a live aggregate over profiles (see the RPC below),
-- so removing a dismissal row is what makes a group reappear in Pending.
create table public.university_suggestion_dismissals (
  normalized_text text primary key,
  sample_text text not null,
  dismissed_by uuid not null references public.profiles(id),
  dismissed_at timestamptz not null default now()
);

alter table public.university_suggestion_dismissals enable row level security;

create policy "admin can manage university suggestion dismissals"
on public.university_suggestion_dismissals
for all
using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- Privileged read, same shape as admin_list_profiles: grouped over profiles
-- where the university text is unmatched, excluding dismissed groups.
create or replace function public.admin_list_university_suggestions()
returns table (
  normalized_text text,
  sample_text text,
  profile_count bigint,
  first_seen_at timestamptz,
  last_seen_at timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'admin only';
  end if;

  return query
  select
    lower(trim(p.university)) as normalized_text,
    (array_agg(p.university order by p.created_at asc))[1] as sample_text,
    count(*)::bigint as profile_count,
    min(p.created_at) as first_seen_at,
    max(p.created_at) as last_seen_at
  from public.profiles p
  where p.university_id is null
    and p.university is not null
    and trim(p.university) <> ''
    and not exists (
      select 1 from public.university_suggestion_dismissals d
      where d.normalized_text = lower(trim(p.university))
    )
  group by lower(trim(p.university))
  order by count(*) desc, max(p.created_at) desc;
end;
$$;

revoke all on function public.admin_list_university_suggestions() from public;
grant execute on function public.admin_list_university_suggestions() to authenticated;

-- Dismissed tab / "un-dismiss" path.
create or replace function public.admin_list_dismissed_university_suggestions()
returns table (
  normalized_text text,
  sample_text text,
  dismissed_at timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'admin only';
  end if;

  return query
  select d.normalized_text, d.sample_text, d.dismissed_at
  from public.university_suggestion_dismissals d
  order by d.dismissed_at desc;
end;
$$;

revoke all on function public.admin_list_dismissed_university_suggestions() from public;
grant execute on function public.admin_list_dismissed_university_suggestions() to authenticated;

-- Called by the approve API route right after inserting the new
-- universities row. Exact-match only (not the fuzzy whole-word regex used
-- by the one-time historical backfill) — the suggestion group's identity
-- *is* the normalized exact text, so backfilling looser than that would
-- silently attribute profiles the admin never actually reviewed.
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
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'admin only';
  end if;

  update public.profiles
  set university_id = p_university_id
  where university_id is null
    and lower(trim(university)) = p_normalized_text;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.admin_backfill_university_suggestion(text, uuid) from public;
grant execute on function public.admin_backfill_university_suggestion(text, uuid) to authenticated;
