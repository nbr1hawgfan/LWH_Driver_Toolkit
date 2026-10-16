-- Driver Recruiter (Driver Toolkit v1.19.0). Already applied to tjivcqxnkftujceumdtx.
create table if not exists public.recruit_codes (
  code text primary key, driver_name text not null default '',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.recruit_scans (
  id bigserial primary key,
  code text not null references public.recruit_codes(code) on delete cascade,
  visitor_hash text not null, scan_day date not null, scanned_at timestamptz not null default now(),
  unique (code, visitor_hash, scan_day)
);
create index if not exists recruit_scans_code_idx on public.recruit_scans (code, scanned_at desc);
create table if not exists public.recruit_awards (
  id bigserial primary key,
  code text not null references public.recruit_codes(code) on delete cascade,
  kind text not null check (kind in ('Applied','Hired')), points int not null,
  applicant text not null default '', note text not null default '', awarded_by text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists recruit_awards_code_idx on public.recruit_awards (code, created_at desc);
alter table public.recruit_codes enable row level security;
alter table public.recruit_scans enable row level security;
alter table public.recruit_awards enable row level security;
