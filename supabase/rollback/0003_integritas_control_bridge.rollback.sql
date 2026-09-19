begin;

drop function if exists integritas_private.integritas_upsert_runtime_heartbeat(text,text,text,text,text,jsonb);
drop function if exists integritas_private.integritas_fail_control_command(uuid,text,text,text);
drop function if exists integritas_private.integritas_complete_control_command(uuid,text,jsonb);
drop function if exists integritas_private.integritas_touch_control_command(uuid,text,integer);
drop function if exists integritas_private.integritas_lease_control_command(text,integer);
drop function if exists integritas_private.integritas_enqueue_control_command(text,jsonb,text,uuid,text,uuid);

drop table if exists public.integritas_control_audit;
drop table if exists public.integritas_runtime_heartbeats;
drop table if exists public.integritas_control_commands;

commit;
