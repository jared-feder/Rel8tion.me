const test = require('node:test');
const assert = require('node:assert/strict');

const {
  applyPermissionOverrides,
  basePermissions,
  parseCookies,
  selectWorkspace
} = require('../lib/app-auth');

test('only the platform administrator base role receives platform.admin', () => {
  for (const role of ['agent', 'loan_officer', 'broker', 'buyer', 'staff', 'founder', 'unassigned']) {
    assert.equal(basePermissions(role).includes('platform.admin'), false, `${role} must not receive platform.admin`);
  }
  assert.equal(basePermissions('platform_admin').includes('platform.admin'), true);
});

test('permission overrides can grant and explicitly deny a permission', () => {
  const permissions = applyPermissionOverrides('agent', [
    { permission: 'reports.read', allowed: false },
    { permission: 'team.read', allowed: true }
  ]);
  assert.equal(permissions.includes('reports.read'), false);
  assert.equal(permissions.includes('team.read'), true);
  assert.equal(permissions.includes('platform.admin'), false);
});

test('workspace selection rejects a client-supplied workspace that is not in the authorized list', () => {
  const workspaces = [
    { id: 'agent-one', role: 'agent', is_primary: true },
    { id: 'loan-one', role: 'loan_officer', is_primary: false }
  ];
  assert.equal(selectWorkspace(workspaces, 'loan-one').id, 'loan-one');
  assert.equal(selectWorkspace(workspaces, 'unowned-platform-admin').id, 'agent-one');
});

test('cookie parser handles encoded values without trusting malformed pairs', () => {
  const request = {
    headers: {
      cookie: 'rel8tion_app_access=header.payload.signature; rel8tion_app_refresh=refresh%20token; malformed'
    }
  };
  const cookies = parseCookies(request);
  assert.equal(cookies.rel8tion_app_access, 'header.payload.signature');
  assert.equal(cookies.rel8tion_app_refresh, 'refresh token');
  assert.equal(cookies.malformed, undefined);
});
