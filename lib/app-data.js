const {
  clean,
  hasPermission,
  safeRows,
  serviceRest,
  unique
} = require('./app-auth');

const ROLE_COPY = Object.freeze({
  agent: {
    eyebrow: 'Agent workspace',
    title: 'Run today’s open houses and follow-ups.',
    description: 'Buyer activity, disclosures, events, and relationship follow-up stay in one operating view.',
    quickActions: [
      ['Create open house', '/sign-demo-activate', 'events.manage'],
      ['Activate Event Pass', '/claim', 'devices.activate'],
      ['Request mortgage support', '/loan-officer-support', 'mortgage.request'],
      ['Create follow-up', '/tasks', 'tasks.manage']
    ]
  },
  loan_officer: {
    eyebrow: 'Loan officer workspace',
    title: 'Cover the right events and move financing conversations forward.',
    description: 'Assigned agents, coverage commitments, and buyer financing requests are prioritized here.',
    quickActions: [
      ['Confirm coverage', '/field-dashboard?role=loan_officer', 'coverage.manage'],
      ['Review assigned events', '/events', 'events.read'],
      ['Open agent relationships', '/relationships', 'relationships.read'],
      ['Create follow-up', '/tasks', 'tasks.manage']
    ]
  },
  broker: {
    eyebrow: 'Broker / team workspace',
    title: 'See where the team needs intervention.',
    description: 'Adoption, event activity, follow-up accountability, and team-level alerts are scoped to this workspace.',
    quickActions: [
      ['Invite team member', '/settings', 'team.invite'],
      ['Review team events', '/events', 'events.read'],
      ['Review performance', '/reports', 'reports.read'],
      ['Create follow-up', '/tasks', 'tasks.manage']
    ]
  },
  buyer: {
    eyebrow: 'Buyer workspace',
    title: 'Keep the home search moving.',
    description: 'Tours, open houses, conversations, financing steps, and buyer tasks appear only for this buyer workspace.',
    quickActions: [
      ['Review tours', '/events', 'tours.read'],
      ['Open conversations', '/messages', 'messages.read'],
      ['Review financing', '/buyer', 'financing.read'],
      ['View tasks', '/tasks', 'tasks.read']
    ]
  },
  staff: {
    eyebrow: 'Rel8tion staff workspace',
    title: 'Resolve the assigned customer work that matters today.',
    description: 'Only assigned organizations, onboarding work, support cases, and operational tasks are included.',
    quickActions: [
      ['Review assigned accounts', '/relationships', 'organizations.assigned.read'],
      ['Open support work', '/tasks', 'support.assigned.read'],
      ['Open messages', '/messages', 'messages.read']
    ]
  },
  founder: {
    eyebrow: 'Founder Command Center',
    title: 'Operate and grow Rel8tion from the highest-value next action.',
    description: 'Company priorities, engagement, opportunities, operating risks, and failures are brought together without turning the homepage into database administration.',
    quickActions: [
      ['Review company priorities', '/tasks', 'tasks.read'],
      ['Open relationships', '/relationships', 'relationships.read'],
      ['Review operations', '/reports', 'company.operations.read'],
      ['Open messages', '/messages', 'messages.read']
    ]
  },
  platform_admin: {
    eyebrow: 'Operating workspace',
    title: 'Stay focused on operating work first.',
    description: 'Platform administration is available separately and never replaces the normal operating dashboard.',
    quickActions: [
      ['Open platform administration', '/admin', 'platform.admin'],
      ['Review company activity', '/reports', 'company.operations.read'],
      ['Open tasks', '/tasks', 'tasks.read']
    ]
  },
  unassigned: {
    eyebrow: 'Account setup',
    title: 'Your Rel8tion workspace is almost ready.',
    description: 'Your identity is verified, but a role and organization assignment has not been provisioned yet.',
    quickActions: [
      ['Activate a Rel8tion device', '/claim', 'app.onboarding'],
      ['Contact Rel8tion', 'https://rel8tion.me/contact', 'app.onboarding']
    ]
  }
});

function inFilter(values) {
  return `in.(${unique(values).map((value) => encodeURIComponent(value)).join(',')})`;
}

function toTimestamp(value) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function newest(rows, field = 'created_at', limit = 8) {
  return [...(rows || [])].sort((left, right) => toTimestamp(right[field]) - toTimestamp(left[field])).slice(0, limit);
}

function todayBounds() {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { now, start, end };
}

function isToday(value) {
  const { start, end } = todayBounds();
  const time = toTimestamp(value);
  return time >= start.getTime() && time < end.getTime();
}

function isFuture(value) {
  return toTimestamp(value) >= Date.now();
}

async function safeCount(path, warnings, label) {
  try {
    const { response } = await serviceRest(path, {
      method: 'HEAD',
      headers: { Prefer: 'count=exact', Range: '0-0' }
    });
    const contentRange = response.headers.get('content-range') || '';
    const total = Number(contentRange.split('/')[1]);
    return Number.isFinite(total) ? total : 0;
  } catch (error) {
    if ([400, 404].includes(Number(error.status)) || error.code === '42P01' || error.code === '42703') {
      warnings.push(`${label} is not available.`);
      return 0;
    }
    throw error;
  }
}

async function loadAssignments(workspaceId, warnings) {
  if (!workspaceId || String(workspaceId).startsWith('legacy-') || String(workspaceId).startsWith('setup-')) return [];
  return safeRows(
    `app_domain_assignments?workspace_id=eq.${encodeURIComponent(workspaceId)}&status=eq.active&select=id,resource_type,resource_id,relationship_type,metadata,created_at`,
    warnings,
    'Workspace domain assignments'
  );
}

async function loadTasks(context, warnings) {
  const workspaceId = context.activeWorkspace.id;
  if (String(workspaceId).startsWith('legacy-') || String(workspaceId).startsWith('setup-')) return [];
  return safeRows(
    `app_tasks?or=(workspace_id.eq.${encodeURIComponent(workspaceId)},assignee_user_id.eq.${encodeURIComponent(context.user.id)})&status=in.(open,in_progress,blocked)&select=id,title,description,status,priority,due_at,action_label,action_href,relationship_label,created_at&order=priority.desc,due_at.asc.nullslast&limit=40`,
    warnings,
    'Workspace tasks'
  );
}

async function loadActivity(context, warnings) {
  const workspaceId = context.activeWorkspace.id;
  if (String(workspaceId).startsWith('legacy-') || String(workspaceId).startsWith('setup-')) return [];
  return safeRows(
    `app_activity_events?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=id,event_type,title,description,actor_label,occurred_at,resource_type,resource_id&order=occurred_at.desc&limit=20`,
    warnings,
    'Workspace activity'
  );
}

function taskAction(task) {
  return {
    label: clean(task.action_label, 80) || 'Open task',
    href: clean(task.action_href, 500) || '/tasks'
  };
}

function nextAction(tasks, context, roleData) {
  const task = tasks[0];
  if (task) {
    return {
      eyebrow: task.priority === 'urgent' ? 'Urgent next action' : 'Highest-priority action',
      title: clean(task.title, 180),
      description: clean(task.description, 400) || 'This task is ready for attention.',
      meta: [clean(task.relationship_label, 160), task.due_at ? `Due ${new Date(task.due_at).toLocaleString('en-US')}` : ''].filter(Boolean).join(' · '),
      action: taskAction(task)
    };
  }

  if (context.activeWorkspace.role === 'unassigned') {
    return {
      eyebrow: 'Setup required',
      title: 'Finish role and organization provisioning',
      description: 'No trusted workspace membership exists for this account yet, so Rel8tion is correctly withholding customer and operational data.',
      meta: 'No data access has been granted',
      action: { label: 'Activate a device', href: '/claim' }
    };
  }

  return {
    eyebrow: 'You are caught up',
    title: 'No urgent assigned work is waiting.',
    description: 'New authorized tasks and activity will appear here as they are assigned to this workspace.',
    meta: `${roleData.eyebrow} · live data only`,
    action: roleData.quickActions[0] ? { label: roleData.quickActions[0][0], href: roleData.quickActions[0][1] } : null
  };
}

function assignmentRelationships(assignments) {
  return (assignments || [])
    .filter((row) => row.metadata?.attention_reason || row.metadata?.recommended_next_step)
    .slice(0, 8)
    .map((row) => ({
      id: row.id,
      name: clean(row.metadata?.label || row.metadata?.name || row.resource_id, 180),
      type: clean(row.relationship_type || row.resource_type, 100),
      reason: clean(row.metadata?.attention_reason, 280) || 'Assigned relationship needs review.',
      last_interaction: clean(row.metadata?.last_interaction_at, 80) || null,
      recommended_next_step: clean(row.metadata?.recommended_next_step, 240) || 'Review the relationship.',
      action: {
        label: clean(row.metadata?.action_label, 80) || 'Open relationship',
        href: clean(row.metadata?.action_href, 500) || '/relationships'
      }
    }));
}

function activityItems(rows) {
  return newest(rows, 'occurred_at', 10).map((row) => ({
    id: row.id,
    type: clean(row.event_type, 100),
    title: clean(row.title, 180),
    description: clean(row.description, 320),
    actor: clean(row.actor_label, 160) || null,
    occurred_at: row.occurred_at
  }));
}

function quickActions(roleData, context) {
  return roleData.quickActions
    .filter(([, , permission]) => !permission || hasPermission(context, permission))
    .map(([label, href]) => ({ label, href }));
}

async function agentMetrics(context, assignments, warnings) {
  const slugs = unique([
    context.activeWorkspace.metadata?.agent_slug,
    ...assignments.filter((row) => row.resource_type === 'agent_slug').map((row) => row.resource_id)
  ].map((value) => clean(value, 160)));
  if (!slugs.length) {
    warnings.push('No agent record is assigned to this workspace.');
    return { metrics: [], events: [], checkins: [] };
  }
  const events = await safeRows(
    `open_house_events?host_agent_slug=${inFilter(slugs)}&select=id,status,start_time,end_time,ended_at,host_agent_slug,setup_context,created_at&order=start_time.asc.nullslast&limit=100`,
    warnings,
    'Assigned agent events'
  );
  const eventIds = unique(events.map((row) => row.id));
  const checkins = eventIds.length ? await safeRows(
    `event_checkins?open_house_event_id=${inFilter(eventIds)}&select=id,open_house_event_id,visitor_name,created_at,metadata&order=created_at.desc&limit=200`,
    warnings,
    'Assigned event check-ins'
  ) : [];
  return {
    events,
    checkins,
    metrics: [
      { key: 'upcoming_events', label: 'Upcoming events', value: events.filter((row) => !row.ended_at && isFuture(row.start_time)).length },
      { key: 'live_events', label: 'Live events', value: events.filter((row) => row.status === 'active' && !row.ended_at).length },
      { key: 'new_buyers', label: 'Buyer check-ins today', value: checkins.filter((row) => isToday(row.created_at)).length }
    ]
  };
}

async function loanOfficerMetrics(context, warnings) {
  const uid = context.user.id;
  const participants = await safeRows(
    `field_demo_visit_participants?participant_uid=eq.${encodeURIComponent(uid)}&select=id,field_demo_visit_id,status,role,responsibility,created_at&limit=200`,
    warnings,
    'Loan-officer field assignments'
  );
  const sessions = await safeRows(
    `event_loan_officer_sessions?loan_officer_uid=eq.${encodeURIComponent(uid)}&select=id,open_house_event_id,status,signed_in_at,signed_out_at,created_at&order=created_at.desc&limit=200`,
    warnings,
    'Loan-officer event sessions'
  );
  const visitIds = unique(participants.map((row) => row.field_demo_visit_id));
  const visits = visitIds.length ? await safeRows(
    `field_demo_visits?id=${inFilter(visitIds)}&select=id,status,scheduled_start,scheduled_end,address,agent_name,created_at&order=scheduled_start.asc.nullslast&limit=200`,
    warnings,
    'Assigned field visits'
  ) : [];
  return {
    participants,
    sessions,
    visits,
    metrics: [
      { key: 'assigned_agents', label: 'Assigned relationships', value: unique(participants.map((row) => row.field_demo_visit_id)).length },
      { key: 'upcoming_coverage', label: 'Upcoming coverage', value: visits.filter((row) => isFuture(row.scheduled_start) && row.status !== 'cancelled').length },
      { key: 'live_events', label: 'Live coverage', value: sessions.filter((row) => row.status === 'live' && !row.signed_out_at).length }
    ]
  };
}

async function brokerMetrics(assignments, warnings) {
  const slugs = unique(assignments.filter((row) => row.resource_type === 'agent_slug').map((row) => clean(row.resource_id, 160)));
  if (!slugs.length) {
    warnings.push('No team agents are assigned to this broker workspace.');
    return { metrics: [] };
  }
  const events = await safeRows(
    `open_house_events?host_agent_slug=${inFilter(slugs)}&select=id,status,start_time,ended_at,host_agent_slug&limit=300`,
    warnings,
    'Team events'
  );
  return {
    events,
    metrics: [
      { key: 'team_members', label: 'Assigned agents', value: slugs.length },
      { key: 'team_events', label: 'Upcoming team events', value: events.filter((row) => isFuture(row.start_time) && !row.ended_at).length },
      { key: 'live_events', label: 'Live team events', value: events.filter((row) => row.status === 'active' && !row.ended_at).length }
    ]
  };
}

async function buyerMetrics(assignments, warnings) {
  const leadIds = unique(assignments.filter((row) => ['buyer', 'lead'].includes(row.resource_type)).map((row) => clean(row.resource_id, 100)));
  if (!leadIds.length) {
    warnings.push('No buyer record is assigned to this workspace.');
    return { metrics: [] };
  }
  const leads = await safeRows(
    `leads?id=${inFilter(leadIds)}&select=id,name,preapproved,property_address,created_at&limit=20`,
    warnings,
    'Assigned buyer records'
  );
  return {
    leads,
    metrics: [
      { key: 'saved_properties', label: 'Saved properties', value: 0, unavailable: true },
      { key: 'upcoming_tours', label: 'Upcoming tours', value: 0, unavailable: true },
      { key: 'buyer_records', label: 'Active buyer records', value: leads.length }
    ]
  };
}

async function companyMetrics(warnings) {
  const [agents, events, checkins, organizations, failures] = await Promise.all([
    safeCount('agents?select=id', warnings, 'Agent count'),
    safeCount('open_house_events?select=id', warnings, 'Event count'),
    safeCount('event_checkins?select=id', warnings, 'Buyer opportunity count'),
    safeCount('app_organizations?status=eq.active&select=id', warnings, 'Organization count'),
    safeCount('app_activity_events?severity=eq.error&select=id', warnings, 'Failure count')
  ]);
  return {
    metrics: [
      { key: 'agents', label: 'Agent profiles', value: agents },
      { key: 'events', label: 'Open-house activity', value: events },
      { key: 'buyer_opportunities', label: 'Buyer opportunities', value: checkins },
      { key: 'organizations', label: 'Organizations', value: organizations },
      { key: 'failures', label: 'Failures requiring review', value: failures, urgent: failures > 0 }
    ]
  };
}

async function roleMetrics(context, assignments, warnings) {
  switch (context.activeWorkspace.role) {
    case 'agent':
      return agentMetrics(context, assignments, warnings);
    case 'loan_officer':
      return loanOfficerMetrics(context, warnings);
    case 'broker':
      return brokerMetrics(assignments, warnings);
    case 'buyer':
      return buyerMetrics(assignments, warnings);
    case 'founder':
    case 'platform_admin':
      return companyMetrics(warnings);
    case 'staff':
      return {
        metrics: [
          { key: 'assigned_accounts', label: 'Assigned accounts', value: assignments.filter((row) => row.resource_type === 'organization').length },
          { key: 'assigned_cases', label: 'Assigned support cases', value: assignments.filter((row) => row.resource_type === 'support_case').length }
        ]
      };
    default:
      return { metrics: [] };
  }
}

async function buildHomeData(context) {
  const warnings = [...(context.warnings || [])];
  const role = context.activeWorkspace.role;
  const roleData = ROLE_COPY[role] || ROLE_COPY.unassigned;
  const [assignments, tasks, activity] = await Promise.all([
    loadAssignments(context.activeWorkspace.id, warnings),
    loadTasks(context, warnings),
    loadActivity(context, warnings)
  ]);
  const roleResult = await roleMetrics(context, assignments, warnings);
  const taskCounts = {
    due_today: tasks.filter((task) => task.due_at && isToday(task.due_at)).length,
    urgent: tasks.filter((task) => task.priority === 'urgent' || task.status === 'blocked').length
  };
  const metrics = [
    ...(roleResult.metrics || []),
    { key: 'follow_ups_due', label: 'Follow-ups due today', value: taskCounts.due_today },
    { key: 'urgent_items', label: 'Urgent items', value: taskCounts.urgent, urgent: taskCounts.urgent > 0 }
  ];

  return {
    workspace: context.activeWorkspace,
    permissions: context.permissions,
    hero: {
      eyebrow: roleData.eyebrow,
      title: roleData.title,
      description: roleData.description
    },
    next_action: nextAction(tasks, context, roleData),
    today: metrics,
    relationships: assignmentRelationships(assignments),
    activity: activityItems(activity),
    quick_actions: quickActions(roleData, context),
    task_count: tasks.length,
    data_status: {
      live: true,
      source: context.source,
      warnings: unique(warnings),
      note: warnings.length
        ? 'Only sources that could be authorized and verified are shown.'
        : 'All visible data is scoped to the server-verified active workspace.'
    }
  };
}

async function buildAdminSummary(context) {
  if (!hasPermission(context, 'platform.admin')) {
    const error = new Error('Platform administrator permission is required.');
    error.status = 403;
    throw error;
  }
  const warnings = [];
  const [users, organizations, events, signs, eventPasses, outreach, failures, auditEvents] = await Promise.all([
    safeCount('app_workspace_memberships?status=eq.active&select=id', warnings, 'Application user count'),
    safeCount('app_organizations?status=eq.active&select=id', warnings, 'Organization count'),
    safeCount('open_house_events?status=eq.active&select=id', warnings, 'Active event count'),
    safeCount('smart_signs?select=id', warnings, 'Smart Sign count'),
    safeCount('smart_sign_inventory?inventory_type=in.(event_pass,sponsored_event_pass)&select=id', warnings, 'Event Pass count'),
    safeCount('agent_outreach_queue?initial_sent_at=is.null&select=id', warnings, 'Pending outreach count'),
    safeCount('app_activity_events?severity=eq.error&select=id', warnings, 'Failed automation count'),
    safeCount('app_audit_log?select=id', warnings, 'Audit event count')
  ]);
  return {
    metrics: [
      ['Authorized memberships', users],
      ['Organizations', organizations],
      ['Active events', events],
      ['Smart Signs', signs],
      ['Event Pass inventory', eventPasses],
      ['Pending outreach', outreach],
      ['Failed automations', failures],
      ['Audit events', auditEvents]
    ].map(([label, value]) => ({ label, value })),
    warnings: unique(warnings),
    areas: [
      'Users and memberships',
      'Organizations and teams',
      'Roles and permissions',
      'Plans and billing status',
      'Event Pass and Smart Sign inventory',
      'NFC and device assignments',
      'Open-house ingestion and enrichment',
      'Outreach queues and messaging usage',
      'Compliance records and audit logs',
      'Failed jobs and automations'
    ]
  };
}

module.exports = {
  ROLE_COPY,
  buildAdminSummary,
  buildHomeData,
  safeCount
};
