# REL8TION Universal App and Platform Admin Guide

Last updated: July 29, 2026

## The short version

REL8TION now has a shared application entrance and the technical foundation for giving different kinds of users different workspaces after they sign in.

This does **not** replace REL8TION COMMAND. COMMAND remains the operational admin dashboard used today for outreach, agents, Event Passes, signs, reporting, and related owner workflows.

Platform Admin is a separate, future-facing permission and workspace for managing the REL8TION platform itself. The authorization boundary and starter screen exist, but the production role records, management screens, and provisioning workflow have not been activated.

## Why this was built

Before this work, REL8TION had several useful dashboards and field flows, but they were separate pages with different assumptions about identity, navigation, and access:

- Agent operations
- Loan-officer operations
- Open House Kit operations
- REL8TION COMMAND
- NFC, QR, Event Pass, Smart Sign, claim, activation, and check-in flows

That structure works for individual product flows, but it does not provide one secure application where a person can sign in, have the server determine their role and organization, and see only the data and actions they are allowed to use.

The universal app foundation was created to support that future without rewriting or breaking the existing field workflows.

## What is live now

### Universal application gateway

`https://app.rel8tion.me/` now opens a mobile-friendly REL8TION gateway with:

- Sign in
- Device activation
- Invitation entry
- Event or activation-code entry

The gateway itself does not contain customer or administrative data.

### Shared authenticated session

The application has server-managed sign-in, sign-out, and session routes. Supabase access and refresh tokens are stored in Secure, HttpOnly cookies. The browser does not decide its own role.

### Server-verified workspaces

The server can resolve a user's available workspaces and permissions. A browser may request a workspace by its opaque id, but it cannot grant itself a role by changing a URL, query parameter, or browser metadata.

### Role definitions

The code contains permission definitions for:

- Real-estate agent
- Loan officer
- Broker or team leader
- Buyer
- REL8TION staff
- Founder
- Platform administrator
- Unassigned account setup

These definitions describe what each future workspace may see. They do not mean every role has a complete production dashboard today.

### Existing loan-officer compatibility

An authenticated loan officer can receive the existing compatibility workspace only when the Supabase Auth user id exactly matches an active `verified_profiles.uid`.

### Safe unassigned state

A signed-in user who has no verified workspace receives an account-setup workspace with no customer-data permissions. The system does not guess a role.

### Existing field routes remain separate

The permanent NFC, QR, Event Pass, Smart Sign, event, claim, agent, loan-officer, disclosure, check-in, onboarding, and activation routes remain in place. The universal application was added around them rather than replacing them.

## REL8TION COMMAND versus Platform Admin

### REL8TION COMMAND

COMMAND is the operational owner/admin dashboard used today.

It currently supports areas such as:

- Outreach operations and replies
- Agent records and relationship activity
- Agent ranking and production intelligence
- Event Pass and sign operations
- Open-house confirmation and reporting
- Loan-officer assignment and related operational controls

COMMAND uses its established server-side admin-token or allowlisted admin-NFC-UID authorization. Browser-local dashboard locking is an additional user-experience control, not the primary server authorization boundary.

### Platform Admin

Platform Admin is intended to become the system-management area for the universal app.

Its intended responsibilities include:

- Managing platform users
- Creating and managing organizations
- Assigning users to workspaces
- Granting or denying specific permissions
- Managing platform inventory across organizations
- Reviewing privileged audit history
- Supporting staff, founder, and multi-organization access

The route and permission check exist. The protected summary endpoint also exists. The full management product does not.

### How `/admin` behaves

The `/admin` entry preserves both systems safely:

1. An established COMMAND admin using a verified NFC UID or admin token is sent to COMMAND.
2. A browser with existing same-origin COMMAND credentials can continue to COMMAND and reuse them.
3. A future authenticated universal-app user with `platform.admin` permission can enter Platform Admin.
4. An authenticated universal-app user without that permission is denied.

Every privileged API independently checks authorization. Merely loading an HTML shell does not return administrative data.

## What did not change

The rollout did not:

- Remove or replace REL8TION COMMAND
- Change the existing COMMAND admin UID or token
- Apply the proposed role-based database migration
- Assign anyone the Platform Administrator role
- Convert existing agents, buyers, brokers, or staff into universal-app users
- Change Event Pass, Smart Sign, NFC, QR, claim, check-in, or disclosure behavior
- Move borrower application data into REL8TION
- Create production membership, task, activity, or audit rows

## What still needs to be done

### 1. Review and test the RBAC migration

The additive migration at `supabase/migrations/20260728073613_universal_app_rbac.sql` proposes:

- Organizations
- Workspaces
- Workspace memberships
- Permission overrides
- Domain assignments
- Tasks
- Activity events
- Audit records
- Row Level Security policies

It must first be reviewed and applied to an isolated Supabase environment. It should not be applied directly to production as the first test.

### 2. Decide the initial user and organization model

Before production provisioning, REL8TION needs explicit answers for:

- Which organization types launch first
- Whether one user may hold multiple roles at launch
- Who can invite users
- Who approves role changes
- How suspended or removed users lose access
- Which organization owns each agent, buyer, event, sign, and relationship record

### 3. Build an audited provisioning workflow

There is no complete production interface yet for:

- Creating an organization
- Creating a workspace
- Linking a Supabase Auth user
- Assigning a role
- Assigning an organization, team, territory, agent, buyer, event, or account scope
- Revoking or changing access

These actions should occur through privileged server routes and write audit records.

### 4. Connect real role-specific data

The shared shell can render authorized actions, counts, relationships, activity, and quick actions. Existing product tables do not all contain the organization and assignment fields required for complete tenant isolation.

Each module must be connected deliberately:

- Agent workspace
- Loan-officer workspace
- Broker/team workspace
- Buyer workspace
- Staff workspace
- Founder workspace
- Platform Admin

Until a source is safely connected, the application should continue showing an honest empty or setup state.

### 5. Build the real Platform Admin screens

The current Platform Admin page is a protected starting shell and summary, not a complete administrative product.

The next screens should include:

- Users and access
- Organizations and workspaces
- Membership and permission editor
- Domain-assignment editor
- Inventory overview
- Audit-log viewer
- Safe suspend, revoke, and recovery actions

Destructive or high-risk actions should require explicit confirmation and server-side audit logging.

### 6. Provision the first Platform Administrator

Only after the migration, provisioning APIs, and audit controls are tested should the owner account receive a production Platform Administrator membership.

The existing COMMAND credential should remain available during the transition as a separate recovery and operations path.

### 7. Add complete authentication lifecycle support

Production still needs a unified plan for:

- Invitations
- Password recovery
- Email or phone verification
- Account linking
- Multi-role workspace switching
- Session revocation
- Lost-device recovery
- Support-assisted access recovery

### 8. Verify every role in an isolated environment

Testing should cover:

- A user cannot choose a role through URL parameters
- A user cannot open another organization's workspace
- Permission overrides grant and deny correctly
- Suspended memberships stop working
- An unassigned user receives no customer data
- Platform Admin data is unavailable without `platform.admin`
- COMMAND continues working independently
- Existing NFC, QR, Event Pass, sign, event, claim, and dashboard routes remain compatible

### 9. Plan the transition from legacy dashboards

Legacy dashboards should be moved into the shared shell only when the replacement module has equal or better:

- Functionality
- Authorization
- Mobile usability
- Recovery behavior
- Operational reliability

They should not be removed merely because the universal shell exists.

## Recommended order of work

1. Keep COMMAND and all field workflows operating as they do now.
2. Create an isolated Supabase test environment.
3. Review and apply the additive RBAC migration there.
4. Build audited organization, workspace, membership, and revocation APIs.
5. Provision test accounts for each role.
6. Connect one role at a time, beginning with the role that has the clearest identity and data boundary.
7. Build and test the full Platform Admin management screens.
8. Provision the owner as the first production Platform Administrator.
9. Run security, route-regression, and recovery testing.
10. Migrate legacy dashboard functions incrementally rather than through a single cutover.

## Recommended immediate decision

The most important next decision is not visual. It is choosing the first production role to complete end to end.

The safest current candidate is the loan-officer role because Supabase Auth already binds those users to `verified_profiles.uid`. After that role is complete, the same pattern can be extended to agents, brokers, buyers, staff, and Platform Admin with explicit organization and assignment rules.

Until that next phase is approved, REL8TION COMMAND should remain the primary operational admin dashboard.
