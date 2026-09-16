\set ON_ERROR_STOP on

create or replace function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $$
begin
  if not coalesce(condition, false) then
    raise exception 'ASSERTION FAILED: %', message;
  end if;
end;
$$;

insert into public.integritas_cases(id)
values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd')
on conflict (id) do nothing;

insert into public.integritas_documents(
  id, case_id, name, mime_type, size_bytes, sha256, storage_path, extraction_status
)
select
  ('10000000-0000-4000-8000-' || lpad(gs::text, 12, '0'))::uuid,
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid,
  format('doc-%s.txt', gs), 'text/plain', gs,
  lpad(to_hex(gs), 64, '0'), format('limit/doc-%s', gs), 'pending'
from generate_series(1, 20) gs;
select pg_temp.assert_true(
  (select count(*) from public.integritas_documents
   where case_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd') = 20,
  'the first 20 documents are accepted'
);

create or replace function pg_temp.assert_twenty_first_rejected()
returns void language plpgsql as $$
begin
  insert into public.integritas_documents(
    id, case_id, name, mime_type, size_bytes, sha256, storage_path, extraction_status
  ) values (
    '10000000-0000-4000-8000-000000000021',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    'doc-21.txt', 'text/plain', 21, lpad(to_hex(21), 64, '0'), 'limit/doc-21', 'pending'
  );
  raise exception 'expected document 21 to be rejected';
exception when check_violation then
  if sqlerrm not like '%maximum 20%' then raise; end if;
end;
$$;

select pg_temp.assert_twenty_first_rejected();
select pg_temp.assert_true(
  (select count(*) from public.integritas_documents
   where case_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd') = 20,
  'rejected document 21 does not persist'
);

delete from public.integritas_documents where case_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.integritas_cases where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
