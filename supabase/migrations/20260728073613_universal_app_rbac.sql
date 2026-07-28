-- Additive universal application authorization model.
-- This migration is intentionally not applied by the feature branch or preview.

create extension if not exists pgcrypto;

create table if not exists public.app_organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  type text not null default 'customer'
    check (type in ('platform', 'brokerage', 'team', 'lender', 'customer', 'partner')),
  status text not null default 'active'
    check (status in ('active', 'inactive', 'suspended')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_workspaces (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.app_organizations(id) on delete restrict,
  role text not null
    check (role in ('agent', 'loan_officer', 'broker', 'buyer', 'staff', 'founder', 'platform_admin')),
  name text not null,
  team_id text,
  territory text,
  subscription_level text not null default 'standard',
  feature_level text not null default 'core',
  status text not null default 'active'
    check (status in ('active', 'inactive', 'suspended')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_workspace_memberships (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  is_primary boolean not null default false,
  status text not null default 'active'
    check (status in ('invited', 'active', 'inactive', 'suspended')),
  invited_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create unique index if not exists app_workspace_memberships_one_primary_per_user
  on public.app_workspace_memberships (user_id)
  where is_primary = true and status = 'active';

create index if not exists app_workspace_memberships_user_status_idx
  on public.app_workspace_memberships (user_id, status);

create index if not exists app_workspaces_organization_role_idx
  on public.app_workspaces (organization_id, role, status);

create table if not exists public.app_permission_overrides (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  permission text not null,
  allowed boolean not null,
  reason text,
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id, permission)
);

create index if not exists app_permission_overrides_lookup_idx
  on public.app_permission_overrides (user_id, workspace_id);

create table if not exists public.app_domain_assignments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  resource_type text not null,
  resource_id text not null,
  relationship_type text,
  status text not null default 'active'
    check (status in ('active', 'inactive', 'completed')),
  metadata jsonb not null default '{}'::jsonb,
  assigned_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, resource_type, resource_id, relationship_type)
);

create index if not exists app_domain_assignments_workspace_idx
  on public.app_domain_assignments (workspace_id, status, resource_type);

create table if not exists public.app_tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  assignee_user_id uuid references auth.users(id) on delete set null,
  title text not null,
  description text,
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'blocked', 'completed', 'cancelled')),
  priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high', 'urgent')),
  due_at timestamptz,
  relationship_label text,
  action_label text,
  action_href text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists app_tasks_workspace_status_due_idx
  on public.app_tasks (workspace_id, status, due_at);

create index if not exists app_tasks_assignee_status_idx
  on public.app_tasks (assignee_user_id, status);

create table if not exists public.app_activity_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  event_type text not null,
  title text not null,
  description text,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_label text,
  resource_type text,
  resource_id text,
  severity text not null default 'info'
    check (severity in ('info', 'notice', 'warning', 'error')),
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists app_activity_events_workspace_time_idx
  on public.app_activity_events (workspace_id, occurred_at desc);

create table if not exists public.app_audit_log (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users(id) on delete set null,
  workspace_id uuid references public.app_workspaces(id) on delete set null,
  organization_id uuid references public.app_organizations(id) on delete set null,
  action text not null,
  resource_type text not null,
  resource_id text,
  request_id text,
  ip_hash text,
  before_state jsonb,
  after_state jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists app_audit_log_workspace_time_idx
  on public.app_audit_log (workspace_id, created_at desc);

create index if not exists app_audit_log_resource_idx
  on public.app_audit_log (resource_type, resource_id, created_at desc);

alter table public.app_organizations enable row level security;
alter table public.app_workspaces enable row level security;
alter table public.app_workspace_memberships enable row level security;
alter table public.app_permission_overrides enable row level security;
alter table public.app_domain_assignments enable row level security;
alter table public.app_tasks enable row level security;
alter table public.app_activity_events enable row level security;
alter table public.app_audit_log enable row level security;

revoke all on public.app_organizations from anon;
revoke all on public.app_workspaces from anon;
revoke all on public.app_workspace_memberships from anon;
revoke all on public.app_permission_overrides from anon;
revoke all on public.app_domain_assignments from anon;
revoke all on public.app_tasks from anon;
revoke all on public.app_activity_events from anon;
revoke all on public.app_audit_log from anon;

grant select on public.app_organizations to authenticated;
grant select on public.app_workspaces to authenticated;
grant select on public.app_workspace_memberships to authenticated;
grant select on public.app_permission_overrides to authenticated;
grant select on public.app_domain_assignments to authenticated;
grant select on public.app_tasks to authenticated;
grant select on public.app_activity_events to authenticated;
grant select on public.app_audit_log to authenticated;

drop policy if exists app_memberships_read_own on public.app_workspace_memberships;
create policy app_memberships_read_own
  on public.app_workspace_memberships
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists app_workspaces_read_member on public.app_workspaces;
create policy app_workspaces_read_member
  on public.app_workspaces
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.app_workspace_memberships membership
      where membership.workspace_id = app_workspaces.id
        and membership.user_id = auth.uid()
        and membership.status = 'active'
    )
  );

drop policy if exists app_organizations_read_member on public.app_organizations;
create policy app_organizations_read_member
  on public.app_organizations
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.app_workspaces workspace
      join public.app_workspace_memberships membership
        on membership.workspace_id = workspace.id
      where workspace.organization_id = app_organizations.id
        and workspace.status = 'active'
        and membership.user_id = auth.uid()
        and membership.status = 'active'
    )
  );

drop policy if exists app_permission_overrides_read_own on public.app_permission_overrides;
create policy app_permission_overrides_read_own
  on public.app_permission_overrides
  for select
  to authenticated
  using (
    user_id = auth.uid()
    and exists (
      select 1
      from public.app_workspace_memberships membership
      where membership.workspace_id = app_permission_overrides.workspace_id
        and membership.user_id = auth.uid()
        and membership.status = 'active'
    )
  );

drop policy if exists app_domain_assignments_read_member on public.app_domain_assignments;
create policy app_domain_assignments_read_member
  on public.app_domain_assignments
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.app_workspace_memberships membership
      where membership.workspace_id = app_domain_assignments.workspace_id
        and membership.user_id = auth.uid()
        and membership.status = 'active'
    )
  );

drop policy if exists app_tasks_read_assigned on public.app_tasks;
create policy app_tasks_read_assigned
  on public.app_tasks
  for select
  to authenticated
  using (
    assignee_user_id = auth.uid()
    or exists (
      select 1
      from public.app_workspace_memberships membership
      where membership.workspace_id = app_tasks.workspace_id
        and membership.user_id = auth.uid()
        and membership.status = 'active'
    )
  );

drop policy if exists app_activity_read_member on public.app_activity_events;
create policy app_activity_read_member
  on public.app_activity_events
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.app_workspace_memberships membership
      where membership.workspace_id = app_activity_events.workspace_id
        and membership.user_id = auth.uid()
        and membership.status = 'active'
    )
  );

drop policy if exists app_audit_read_platform_admin on public.app_audit_log;
create policy app_audit_read_platform_admin
  on public.app_audit_log
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.app_workspace_memberships membership
      join public.app_workspaces workspace
        on workspace.id = membership.workspace_id
      where membership.user_id = auth.uid()
        and membership.status = 'active'
        and workspace.status = 'active'
        and workspace.role = 'platform_admin'
    )
  );

comment on table public.app_workspace_memberships is
  'Server-validated universal application membership. Do not derive authorization from auth user_metadata.';

comment on table public.app_permission_overrides is
  'Fine-grained grants or denials applied after the server role permission catalog.';

comment on table public.app_domain_assignments is
  'Explicit resource scope for organization, team, territory, agent, buyer, event, support, and account access.';

comment on table public.app_audit_log is
  'Append-only audit trail for privileged application changes. Writes are reserved for service-role server APIs.';
