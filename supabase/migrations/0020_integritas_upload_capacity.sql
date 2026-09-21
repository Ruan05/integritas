-- Integritas private evidence upload capacity.
-- Free-plan Storage supports up to 50 MiB per file; keep the case bucket private
-- and preserve the existing MIME allowlist.
update storage.buckets
set file_size_limit = 52428800
where id = 'integritas-case-files';

do $$
begin
  if not exists (
    select 1 from storage.buckets
    where id = 'integritas-case-files'
      and public = false
      and file_size_limit = 52428800
  ) then
    raise exception 'integritas-case-files upload capacity update failed';
  end if;
end
$$;
