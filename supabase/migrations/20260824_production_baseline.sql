-- LINK Preview Studio 3.0 — Production baseline
-- Idempotent, additive schema for a fresh or partially configured LINK PREVIEW project.
-- It does NOT delete legacy data or tables.

create extension if not exists pgcrypto;

create table if not exists public.segments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  segment_id uuid references public.segments(id) on delete set null,
  name text not null,
  slug text not null unique,
  status text not null default 'active' check (status in ('active','archived')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.client_profiles (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null unique references public.clients(id) on delete cascade,
  brand_dna jsonb not null default '{}'::jsonb,
  communication_rules jsonb not null default '{}'::jsonb,
  business_rules jsonb not null default '{}'::jsonb,
  default_outputs text[] not null default array['html','pdf']::text[],
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  status text not null default 'active' check (status in ('active','archived')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  client_id uuid references public.clients(id) on delete set null,
  segment_id uuid references public.segments(id) on delete set null,
  parent_id uuid references public.projects(id) on delete set null,
  kind text not null default 'project',
  sort_order integer not null default 0,
  phase text not null default 'discovery'
);

-- Additive compatibility for older projects table.
alter table public.projects add column if not exists client_id uuid references public.clients(id) on delete set null;
alter table public.projects add column if not exists segment_id uuid references public.segments(id) on delete set null;
alter table public.projects add column if not exists parent_id uuid references public.projects(id) on delete set null;
alter table public.projects add column if not exists kind text not null default 'project';
alter table public.projects add column if not exists sort_order integer not null default 0;
alter table public.projects add column if not exists phase text not null default 'discovery';

create table if not exists public.templates (
  id uuid primary key default gen_random_uuid(),
  segment_id uuid references public.segments(id) on delete set null,
  name text not null,
  slug text not null unique,
  creation_type text not null,
  structure jsonb not null default '{}'::jsonb,
  rules jsonb not null default '{}'::jsonb,
  design jsonb not null default '{}'::jsonb,
  output_types text[] not null default array['html','pdf']::text[],
  status text not null default 'active' check (status in ('active','archived')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.design_previews (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'Untitled design',
  slug text not null unique,
  html text not null,
  project_id uuid references public.projects(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  template_id uuid references public.templates(id) on delete set null,
  creation_type text not null default 'preview',
  status text not null default 'draft',
  current_version integer not null default 1 check (current_version >= 1),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.design_previews add column if not exists project_id uuid references public.projects(id) on delete set null;
alter table public.design_previews add column if not exists client_id uuid references public.clients(id) on delete set null;
alter table public.design_previews add column if not exists template_id uuid references public.templates(id) on delete set null;
alter table public.design_previews add column if not exists creation_type text not null default 'preview';
alter table public.design_previews add column if not exists status text not null default 'draft';
alter table public.design_previews add column if not exists current_version integer not null default 1;
alter table public.design_previews add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists public.design_versions (
  id uuid primary key default gen_random_uuid(),
  design_id uuid not null references public.design_previews(id) on delete cascade,
  version_number integer not null check (version_number >= 1),
  html text not null,
  change_summary text,
  source text not null default 'link-preview-studio',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(design_id, version_number)
);

create table if not exists public.generation_files (
  id uuid primary key default gen_random_uuid(),
  design_id uuid not null references public.design_previews(id) on delete cascade,
  version_id uuid references public.design_versions(id) on delete set null,
  file_type text not null,
  storage_bucket text,
  storage_path text,
  external_url text,
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.design_references (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete cascade,
  template_id uuid references public.templates(id) on delete set null,
  design_id uuid references public.design_previews(id) on delete set null,
  name text not null,
  reference_type text not null default 'approved_creation',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.app_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner','editor','viewer')),
  status text not null default 'active' check (status in ('active','disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.share_links (
  id uuid primary key default gen_random_uuid(),
  design_id uuid not null references public.design_previews(id) on delete cascade,
  purpose text not null check (purpose in ('pdf','html','preview')),
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_by text not null default 'link-preview-studio',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete set null,
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  summary text,
  problem_statement text,
  desired_outcome text,
  request_type text not null default 'general',
  source text not null default 'chatgpt',
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  status text not null default 'captured' check (status in ('captured','understanding','proposed','designing','review','approved','in_production','delivered','evolving','closed')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.design_previews add column if not exists request_id uuid references public.requests(id) on delete set null;

create table if not exists public.project_briefs (
  project_id uuid primary key references public.projects(id) on delete cascade,
  problem_statement text,
  objective text,
  solution_summary text,
  deliverable_scope text,
  effort_level text check (effort_level is null or effort_level in ('small','medium','large','xl')),
  repeatable boolean not null default false,
  automation_potential text,
  commercial_notes text,
  evolution_notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.commitments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  request_id uuid references public.requests(id) on delete set null,
  title text not null,
  description text,
  status text not null default 'pending' check (status in ('pending','in_progress','done','cancelled')),
  due_at timestamptz,
  sort_order integer not null default 0,
  source text not null default 'chatgpt',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.deliverables (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  request_id uuid references public.requests(id) on delete set null,
  design_id uuid references public.design_previews(id) on delete set null,
  version_id uuid references public.design_versions(id) on delete set null,
  title text not null,
  deliverable_type text not null default 'link',
  status text not null default 'draft' check (status in ('draft','ready','delivered','archived')),
  external_url text,
  delivered_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_integrations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  provider text not null check (provider in ('supabase','github','vercel','drive','gmail','calendar','attio','other')),
  label text not null,
  external_id text,
  url text,
  environment text,
  status text not null default 'connected' check (status in ('connected','warning','error','disconnected')),
  metadata jsonb not null default '{}'::jsonb,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id,provider,label)
);

create table if not exists public.activity_log (
  id bigint generated always as identity primary key,
  project_id uuid references public.projects(id) on delete set null,
  preview_id uuid,
  design_id uuid references public.design_previews(id) on delete set null,
  request_id uuid references public.requests(id) on delete set null,
  action text not null,
  actor text not null default 'link-preview-studio',
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.activity_log add column if not exists design_id uuid references public.design_previews(id) on delete set null;
alter table public.activity_log add column if not exists request_id uuid references public.requests(id) on delete set null;

create index if not exists projects_client_id_idx on public.projects(client_id);
create index if not exists projects_parent_id_idx on public.projects(parent_id);
create index if not exists design_previews_project_id_idx on public.design_previews(project_id);
create index if not exists design_previews_client_id_idx on public.design_previews(client_id);
create index if not exists design_previews_request_id_idx on public.design_previews(request_id);
create index if not exists design_previews_updated_at_idx on public.design_previews(updated_at desc);
create index if not exists design_versions_design_id_idx on public.design_versions(design_id,version_number desc);
create index if not exists requests_project_id_idx on public.requests(project_id);
create index if not exists requests_status_idx on public.requests(status);
create index if not exists commitments_project_id_idx on public.commitments(project_id);
create index if not exists commitments_status_idx on public.commitments(status);
create index if not exists deliverables_project_id_idx on public.deliverables(project_id);
create index if not exists project_integrations_project_id_idx on public.project_integrations(project_id);
create index if not exists share_links_expires_at_idx on public.share_links(expires_at);
create index if not exists activity_log_project_id_idx on public.activity_log(project_id,created_at desc);

insert into public.segments(name,slug,description) values
('Turismo','turismo','Turismo, experiencias, itinerarios y operación'),
('Hotelería','hoteleria','Hoteles, hospitalidad y experiencia de huéspedes'),
('Gastronomía','gastronomia','Cocina, restaurantes, catering y alimentos'),
('Comercio','comercio','Venta, retail y comercio'),
('Marketing','marketing','Marketing, comunicación y crecimiento'),
('Cultura','cultura','Proyectos culturales y creativos'),
('Ciencia','ciencia','Ciencia, divulgación e investigación'),
('Educación','educacion','Educación y formación'),
('Tarifarios','tarifarios','Tarifas, precios, presupuestos y propuestas'),
('Operaciones','operaciones','Procesos, control y operación'),
('Software','software','Aplicaciones, automatización y software'),
('Servicios profesionales','servicios-profesionales','Consultoría y servicios B2B'),
('Otras','otras','Segmentos futuros')
on conflict (slug) do nothing;

insert into public.projects(name,slug,kind,phase,metadata)
values('General','general','inbox','discovery','{"system":true,"purpose":"unclassified-inbox"}'::jsonb)
on conflict (slug) do nothing;

-- Storage buckets used by future persistent assets/builds.
insert into storage.buckets(id,name,public)
values('preview-assets','preview-assets',false),('preview-builds','preview-builds',false)
on conflict (id) do nothing;

-- Server-only data plane. Supabase Auth remains available to browser users,
-- but app tables are accessed through authenticated server APIs / service role.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'segments','clients','client_profiles','projects','templates','design_previews','design_versions',
    'generation_files','design_references','app_members','share_links','requests','project_briefs',
    'commitments','deliverables','project_integrations','activity_log'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;
