\set ON_ERROR_STOP on

-- The document-limit function is trigger-only and must not be callable through PostgREST or service clients.
revoke execute on function public.integritas_enforce_document_limit() from public;
revoke execute on function public.integritas_enforce_document_limit() from anon;
revoke execute on function public.integritas_enforce_document_limit() from authenticated;
revoke execute on function public.integritas_enforce_document_limit() from service_role;
