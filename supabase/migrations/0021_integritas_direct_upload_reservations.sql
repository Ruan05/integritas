create table if not exists public.integritas_upload_reservations (
  id uuid primary key,
  case_id uuid not null references public.integritas_cases(id) on delete cascade,
  created_by uuid not null,
  idempotency_key text not null,
  name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 52428800),
  storage_path text not null unique,
  status text not null default 'reserved'
    check (status in ('reserved','uploaded','finalized','expired','rejected')),
  expires_at timestamptz not null,
  document_id uuid references public.integritas_documents(id) on delete set null,
  sha256 text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (created_by, idempotency_key)
);

create index if not exists integritas_upload_reservations_case_idx
  on public.integritas_upload_reservations(case_id, created_at desc);

alter table public.integritas_upload_reservations enable row level security;

comment on table public.integritas_upload_reservations is
  'Service-role upload capabilities; application ownership is enforced by the admin API.';
