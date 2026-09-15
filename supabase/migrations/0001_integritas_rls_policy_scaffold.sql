-- Policy scaffold for Integritas. Review against the live schema before applying.
-- Service-role server functions should perform privileged writes; browser users should be constrained by admin identity and case access.

create or replace function public.integritas_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.integritas_admin_users admin_user
    where admin_user.user_id = auth.uid()
  );
$$;

create or replace function public.integritas_can_access_case(case_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.integritas_is_admin()
    or exists (
      select 1
      from public.integritas_case_access access_row
      where access_row.case_id = case_uuid
        and access_row.user_id = auth.uid()
    );
$$;

-- Example pattern. Apply table-specific policies only after confirming column names.
-- create policy "Admins can read cases"
--   on public.integritas_cases
--   for select
--   to authenticated
--   using (public.integritas_is_admin());
