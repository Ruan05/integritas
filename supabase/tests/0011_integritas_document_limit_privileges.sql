\set ON_ERROR_STOP on

do $$
begin
  if has_function_privilege('anon', 'public.integritas_enforce_document_limit()', 'EXECUTE') then
    raise exception 'anon must not execute document-limit trigger function';
  end if;
  if has_function_privilege('authenticated', 'public.integritas_enforce_document_limit()', 'EXECUTE') then
    raise exception 'authenticated must not execute document-limit trigger function';
  end if;
  if has_function_privilege('service_role', 'public.integritas_enforce_document_limit()', 'EXECUTE') then
    raise exception 'service_role must not execute trigger-only document-limit function directly';
  end if;
end;
$$;
