begin;

drop function if exists public.integritas_control_heartbeat(text,text,text,text,text,jsonb);
drop function if exists public.integritas_control_fail(uuid,text,text,text);
drop function if exists public.integritas_control_complete(uuid,text,jsonb);
drop function if exists public.integritas_control_touch(uuid,text,integer);
drop function if exists public.integritas_control_lease(text,integer);
drop function if exists public.integritas_control_enqueue(text,jsonb,text,uuid,text,uuid);

commit;
