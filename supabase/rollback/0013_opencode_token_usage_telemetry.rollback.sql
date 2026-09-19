begin;

do $$
begin
  if to_regclass('public.opencode_runs') is not null then
    alter table public.opencode_runs
      drop column if exists cached_input_tokens,
      drop column if exists output_tokens,
      drop column if exists input_tokens;
  end if;
end
$$;

commit;
