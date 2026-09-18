begin;

do $$
begin
  if to_regclass('public.opencode_runs') is not null then
    alter table public.opencode_runs
      add column if not exists input_tokens bigint,
      add column if not exists output_tokens bigint,
      add column if not exists cached_input_tokens bigint;

    comment on column public.opencode_runs.input_tokens is
      'Provider-reported input/prompt tokens when available.';
    comment on column public.opencode_runs.output_tokens is
      'Provider-reported output/completion tokens when available.';
    comment on column public.opencode_runs.cached_input_tokens is
      'Provider-reported cached input tokens when available.';
  end if;
end
$$;

commit;
