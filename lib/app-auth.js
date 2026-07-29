const crypto = require('crypto');

const ACCESS_COOKIE = 'rel8tion_app_access';
const REFRESH_COOKIE = 'rel8tion_app_refresh';
const DEFAULT_ACCESS_TTL = 60 * 60;
const DEFAULT_REFRESH_TTL = 60 * 60 * 24 * 30;

const ROLE_DEFINITIONS = Object.freeze({
  agent: {
    label: 'Real Estate Agent',
    permissions: [
      'app.home',
      'relationships.read',
      'contacts.read',
      'events.read',
      'events.manage',
      'buyers.read',
      'messages.read',
      'messages.manage',
      'tasks.read',
      'tasks.manage',
      'reports.read',
      'devices.activate',
      'mortgage.request',
      'settings.manage'
    ]
  },
  loan_officer: {
    label: 'Loan Officer',
    permissions: [
      'app.home',
      'relationships.read',
      'agents.read',
      'events.read',
      'coverage.read',
      'coverage.manage',
      'buyers.financing',
      'messages.read',
      'messages.manage',
      'tasks.read',
      'tasks.manage',
      'reports.read',
      'outreach.manage',
      'settings.manage'
    ]
  },
  broker: {
    label: 'Broker / Team Leader',
    permissions: [
      'app.home',
      'relationships.read',
      'contacts.read',
      'events.read',
      'buyers.read',
      'messages.read',
      'tasks.read',
      'tasks.manage',
      'reports.read',
      'team.read',
      'team.manage',
      'team.invite',
      'settings.manage'
    ]
  },
  buyer: {
    label: 'Buyer',
    permissions: [
      'app.home',
      'properties.read',
      'tours.read',
      'tours.manage',
      'events.read',
      'messages.read',
      'messages.manage',
      'tasks.read',
      'tasks.manage',
      'financing.read',
      'settings.manage'
    ]
  },
  staff: {
    label: 'Rel8tion Staff',
    permissions: [
      'app.home',
      'relationships.read',
      'organizations.assigned.read',
      'support.assigned.read',
      'support.assigned.manage',
      'messages.read',
      'messages.manage',
      'tasks.read',
      'tasks.manage',
      'reports.read',
      'settings.manage'
    ]
  },
  founder: {
    label: 'Founder',
    permissions: [
      'app.home',
      'relationships.read',
      'contacts.read',
      'agents.read',
      'events.read',
      'buyers.read',
      'messages.read',
      'messages.manage',
      'tasks.read',
      'tasks.manage',
      'reports.read',
      'company.operations.read',
      'company.operations.manage',
      'settings.manage'
    ]
  },
  platform_admin: {
    label: 'Platform Administrator',
    permissions: [
      'app.home',
      'relationships.read',
      'contacts.read',
      'agents.read',
      'events.read',
      'buyers.read',
      'messages.read',
      'tasks.read',
      'reports.read',
      'company.operations.read',
      'platform.admin',
      'platform.users.manage',
      'platform.organizations.manage',
      'platform.inventory.manage',
      'platform.audit.read',
      'settings.manage'
    ]
  },
  unassigned: {
    label: 'Account Setup',
    permissions: ['app.home', 'app.onboarding']
  }
});

function clean(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function readHeader(req, name) {
  return req.headers?.[name] || req.headers?.[name.toLowerCase()] || req.headers?.[name.toUpperCase()] || '';
}

function parseCookies(req) {
  const cookieHeader = clean(readHeader(req, 'cookie'), 12000);
  return cookieHeader.split(';').reduce((cookies, pair) => {
    const separator = pair.indexOf('=');
    if (separator < 1) return cookies;
    const key = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      cookies[key] = value;
    }
    return cookies;
  }, {});
}

function bearerToken(req) {
  return clean(readHeader(req, 'authorization'), 10000).replace(/^Bearer\s+/i, '').trim();
}

function sessionTokens(req) {
  const cookies = parseCookies(req);
  return {
    accessToken: bearerToken(req) || clean(cookies[ACCESS_COOKIE], 10000),
    refreshToken: clean(cookies[REFRESH_COOKIE], 10000)
  };
}

function isSecureRequest(req) {
  const forwarded = clean(readHeader(req, 'x-forwarded-proto')).toLowerCase();
  const host = clean(readHeader(req, 'host')).toLowerCase();
  if (forwarded) return forwarded === 'https';
  return !host.startsWith('localhost') && !host.startsWith('127.0.0.1');
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value || '')}`, 'Path=/', 'SameSite=Lax', 'HttpOnly'];
  if (options.secure) parts.push('Secure');
  if (Number.isFinite(options.maxAge)) parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
  return parts.join('; ');
}

function appendSetCookies(res, values) {
  const current = res.getHeader?.('Set-Cookie');
  const existing = Array.isArray(current) ? current : current ? [current] : [];
  res.setHeader('Set-Cookie', [...existing, ...values]);
}

function writeSessionCookies(req, res, session) {
  const secure = isSecureRequest(req);
  const accessTtl = Number(session?.expires_in) || DEFAULT_ACCESS_TTL;
  appendSetCookies(res, [
    serializeCookie(ACCESS_COOKIE, clean(session?.access_token, 10000), { secure, maxAge: accessTtl }),
    serializeCookie(REFRESH_COOKIE, clean(session?.refresh_token, 10000), { secure, maxAge: DEFAULT_REFRESH_TTL })
  ]);
}

function clearSessionCookies(req, res) {
  const secure = isSecureRequest(req);
  const expired = new Date(0);
  appendSetCookies(res, [
    serializeCookie(ACCESS_COOKIE, '', { secure, maxAge: 0, expires: expired }),
    serializeCookie(REFRESH_COOKIE, '', { secure, maxAge: 0, expires: expired })
  ]);
}

function setPrivateResponse(res) {
  res.setHeader('Cache-Control', 'private, no-store, no-cache, max-age=0, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Vary', 'Cookie, Authorization, X-Rel8tion-Workspace');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

function requiredConfig() {
  const url = clean(process.env.SUPABASE_URL, 1000).replace(/\/$/, '');
  const serviceRoleEnv = ['SUPABASE', 'SERVICE', 'ROLE', 'KEY'].join('_');
  const key = clean(process.env[serviceRoleEnv], 10000);
  if (!url || !key) {
    const error = new Error('Universal app authentication is not configured.');
    error.status = 503;
    throw error;
  }
  return { url, key };
}

async function parseResponse(response) {
  const raw = await response.text().catch(() => '');
  let payload = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    payload = { raw };
  }
  if (!response.ok) {
    const error = new Error(payload?.msg || payload?.message || payload?.error_description || payload?.error || 'Request failed.');
    error.status = response.status;
    error.code = payload?.code || '';
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function authRequest(path, options = {}) {
  const { url, key } = requiredConfig();
  const response = await fetch(`${url}/auth/v1/${path}`, {
    ...options,
    headers: {
      apikey: key,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  return parseResponse(response);
}

async function serviceRest(path, options = {}) {
  const { url, key } = requiredConfig();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const payload = await parseResponse(response);
  return { payload, response };
}

async function safeRows(path, warnings, label) {
  try {
    const result = await serviceRest(path);
    return Array.isArray(result.payload) ? result.payload : [];
  } catch (error) {
    if ([400, 404].includes(Number(error.status)) || error.code === '42P01' || error.code === '42703') {
      if (warnings) warnings.push(`${label || 'optional source'} is not provisioned.`);
      return [];
    }
    throw error;
  }
}

async function verifiedUser(accessToken) {
  if (!accessToken) return null;
  try {
    return await authRequest('user', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
  } catch (error) {
    if ([401, 403].includes(Number(error.status))) return null;
    throw error;
  }
}

async function refreshSession(refreshToken) {
  if (!refreshToken) return null;
  try {
    return await authRequest('token?grant_type=refresh_token', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: refreshToken })
    });
  } catch (error) {
    if ([400, 401, 403].includes(Number(error.status))) return null;
    throw error;
  }
}

function basePermissions(role) {
  return [...(ROLE_DEFINITIONS[role]?.permissions || ROLE_DEFINITIONS.unassigned.permissions)];
}

function normalizeWorkspace(workspace, membership = {}, organization = null) {
  const role = ROLE_DEFINITIONS[workspace?.role] ? workspace.role : 'unassigned';
  return {
    id: clean(workspace?.id || membership?.id || `workspace-${role}`, 100),
    role,
    role_label: ROLE_DEFINITIONS[role].label,
    name: clean(workspace?.name || ROLE_DEFINITIONS[role].label, 160),
    organization: organization ? {
      id: clean(organization.id, 100),
      name: clean(organization.name, 160),
      slug: clean(organization.slug, 160),
      type: clean(organization.type, 80)
    } : null,
    team_id: clean(workspace?.team_id, 100) || null,
    territory: clean(workspace?.territory, 160) || null,
    subscription_level: clean(workspace?.subscription_level, 80) || 'standard',
    feature_level: clean(workspace?.feature_level, 80) || 'core',
    is_primary: membership?.is_primary === true,
    metadata: workspace?.metadata && typeof workspace.metadata === 'object' ? workspace.metadata : {}
  };
}

async function databaseWorkspaces(userId, warnings) {
  const memberships = await safeRows(
    `app_workspace_memberships?user_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=id,workspace_id,is_primary,created_at`,
    warnings,
    'Universal workspace memberships'
  );
  if (!memberships.length) return [];

  const workspaceIds = unique(memberships.map((row) => clean(row.workspace_id, 100)));
  const workspaces = await safeRows(
    `app_workspaces?id=in.(${workspaceIds.map(encodeURIComponent).join(',')})&status=eq.active&select=id,organization_id,role,name,team_id,territory,subscription_level,feature_level,status,metadata`,
    warnings,
    'Universal workspaces'
  );
  const organizationIds = unique(workspaces.map((row) => clean(row.organization_id, 100)));
  const organizations = organizationIds.length ? await safeRows(
    `app_organizations?id=in.(${organizationIds.map(encodeURIComponent).join(',')})&status=eq.active&select=id,name,slug,type,status`,
    warnings,
    'Universal organizations'
  ) : [];

  const workspaceById = new Map(workspaces.map((row) => [String(row.id), row]));
  const organizationById = new Map(organizations.map((row) => [String(row.id), row]));
  return memberships.flatMap((membership) => {
    const workspace = workspaceById.get(String(membership.workspace_id));
    if (!workspace) return [];
    return [normalizeWorkspace(workspace, membership, organizationById.get(String(workspace.organization_id)) || null)];
  });
}

async function legacyLoanOfficerWorkspace(userId, warnings) {
  const rows = await safeRows(
    `verified_profiles?uid=eq.${encodeURIComponent(userId)}&select=*&limit=1`,
    warnings,
    'Legacy loan-officer profile'
  );
  const profile = rows[0];
  if (!profile) return null;
  const active = !['disabled', 'suspended', 'rejected'].includes(clean(profile.status).toLowerCase());
  if (!active) return null;
  const company = clean(profile.company_name || profile.company || profile.brokerage, 160);
  return normalizeWorkspace({
    id: `legacy-lo-${userId}`,
    role: 'loan_officer',
    name: clean(profile.full_name || profile.name, 160) || 'Loan Officer Workspace',
    subscription_level: 'legacy',
    feature_level: 'coverage',
    metadata: {
      source: 'verified_profiles',
      profile_uid: userId,
      profile_slug: clean(profile.lo_slug || profile.slug, 160)
    }
  }, { is_primary: true }, company ? {
    id: `legacy-company-${crypto.createHash('sha256').update(company).digest('hex').slice(0, 16)}`,
    name: company,
    slug: '',
    type: 'lender'
  } : null);
}

async function permissionOverrides(userId, workspaceId, warnings) {
  if (!workspaceId || String(workspaceId).startsWith('legacy-')) return [];
  return safeRows(
    `app_permission_overrides?user_id=eq.${encodeURIComponent(userId)}&workspace_id=eq.${encodeURIComponent(workspaceId)}&select=permission,allowed`,
    warnings,
    'Workspace permission overrides'
  );
}

function applyPermissionOverrides(role, overrides) {
  const permissions = new Set(basePermissions(role));
  for (const override of overrides || []) {
    const permission = clean(override.permission, 120);
    if (!permission) continue;
    if (override.allowed === false) permissions.delete(permission);
    if (override.allowed === true) permissions.add(permission);
  }
  return [...permissions].sort();
}

function requestedWorkspace(req) {
  const header = clean(readHeader(req, 'x-rel8tion-workspace'), 100);
  const query = req.query || {};
  const value = Array.isArray(query.workspace) ? query.workspace[0] : query.workspace;
  return header || clean(value, 100);
}

function selectWorkspace(workspaces, requestedId) {
  const available = Array.isArray(workspaces) ? workspaces : [];
  if (!available.length) return null;
  if (requestedId) {
    const match = available.find((workspace) => workspace.id === requestedId);
    if (match) return match;
  }
  return available.find((workspace) => workspace.is_primary) || available[0];
}

async function loadWorkspaceContext(user, req) {
  const warnings = [];
  let workspaces = await databaseWorkspaces(user.id, warnings);
  let source = 'rbac';
  if (!workspaces.length) {
    const legacyWorkspace = await legacyLoanOfficerWorkspace(user.id, warnings);
    if (legacyWorkspace) {
      workspaces = [legacyWorkspace];
      source = 'legacy_verified_profile';
    }
  }
  if (!workspaces.length) {
    workspaces = [normalizeWorkspace({
      id: `setup-${user.id}`,
      role: 'unassigned',
      name: 'Finish account setup',
      subscription_level: 'unassigned',
      feature_level: 'onboarding',
      metadata: { source: 'unassigned' }
    }, { is_primary: true })];
    source = 'unassigned';
  }

  const activeWorkspace = selectWorkspace(workspaces, requestedWorkspace(req));
  const overrides = await permissionOverrides(user.id, activeWorkspace.id, warnings);
  const permissions = applyPermissionOverrides(activeWorkspace.role, overrides);
  return {
    activeWorkspace,
    permissions,
    source,
    warnings: unique(warnings),
    workspaces
  };
}

async function resolveSession(req, res) {
  setPrivateResponse(res);
  const initial = sessionTokens(req);
  let accessToken = initial.accessToken;
  let user = await verifiedUser(accessToken);
  let refreshed = false;

  if (!user && initial.refreshToken) {
    const session = await refreshSession(initial.refreshToken);
    if (session?.access_token) {
      writeSessionCookies(req, res, session);
      accessToken = session.access_token;
      user = await verifiedUser(accessToken);
      refreshed = true;
    }
  }

  if (!user) return null;
  const workspaceContext = await loadWorkspaceContext(user, req);
  return {
    accessToken,
    refreshed,
    user,
    ...workspaceContext
  };
}

function publicUser(user) {
  return {
    id: user.id,
    email: clean(user.email, 320),
    name: clean(
      user.user_metadata?.full_name ||
      user.user_metadata?.name ||
      user.email?.split('@')[0],
      160
    ),
    phone: clean(user.phone, 40) || null
  };
}

function hasPermission(context, permission) {
  return Boolean(context?.permissions?.includes(permission));
}

function readJsonBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  try {
    return JSON.parse(req.body);
  } catch {
    return {};
  }
}

module.exports = {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  ROLE_DEFINITIONS,
  applyPermissionOverrides,
  authRequest,
  basePermissions,
  clearSessionCookies,
  clean,
  hasPermission,
  loadWorkspaceContext,
  parseCookies,
  publicUser,
  readJsonBody,
  resolveSession,
  safeRows,
  selectWorkspace,
  serviceRest,
  setPrivateResponse,
  sessionTokens,
  unique,
  verifiedUser,
  writeSessionCookies
};
