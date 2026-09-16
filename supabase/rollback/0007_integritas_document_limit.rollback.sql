\set ON_ERROR_STOP on

drop trigger if exists integritas_documents_max_20
on public.integritas_documents;

drop function if exists public.integritas_enforce_document_limit();
