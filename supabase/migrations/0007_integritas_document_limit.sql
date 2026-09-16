\set ON_ERROR_STOP on

-- Enforce the case evidence ceiling in the database, not only in the browser.
do $$
begin
  if exists (
    select 1
    from public.integritas_documents
    group by case_id
    having count(*) > 20
  ) then
    raise exception 'cannot enforce Integritas document limit: an existing case exceeds 20 documents';
  end if;
end;
$$;

create or replace function public.integritas_enforce_document_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.case_id::text, 0));
  select count(*)::integer
  into current_count
  from public.integritas_documents
  where case_id = new.case_id;

  if current_count >= 20 then
    raise exception 'Integritas case document limit exceeded (maximum 20)'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.integritas_enforce_document_limit() from public;

create trigger integritas_documents_max_20
before insert on public.integritas_documents
for each row
execute function public.integritas_enforce_document_limit();
