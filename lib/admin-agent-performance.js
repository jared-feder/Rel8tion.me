function phoneDigits(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

function normalizedEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function countBy(rows, pick) {
  const counts = {};
  for (const row of rows || []) {
    const key = pick(row);
    if (key) counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function identityFrom(row = {}, prefix = '') {
  return {
    agent_id: row.agent_id || '',
    slug: row.agent_slug || row.slug || '',
    name: row[`${prefix}name`] || row.agent_name || row.name || row.agent || '',
    phone: row[`${prefix}phone`] || row.agent_phone || row.phone || '',
    phone_normalized: row[`${prefix}phone_normalized`] || row.agent_phone_normalized || row.phone_normalized || '',
    email: row[`${prefix}email`] || row.agent_email || row.email || '',
    brokerage: row.brokerage || ''
  };
}

const ACCEPTED_RELATIONSHIP_STATUSES = new Set([
  'accepted_open_house',
  'confirmed_open_house',
  'worked_with'
]);

const INTERESTED_RELATIONSHIP_STATUSES = new Set([
  'interested',
  'drip_scheduled'
]);

const ACCEPTED_VISIT_STATUSES = new Set([
  'scheduled',
  'confirmed',
  'live',
  'completed',
  'converted'
]);

const HOSTED_EVENT_STATUSES = new Set([
  'active',
  'ended',
  'completed'
]);

function normalizedStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function wasOutreachSent(row = {}) {
  return Boolean(
    row.initial_sent_at
    || row.followup_sent_at
    || row.last_outreach_at
    || normalizedStatus(row.initial_send_status) === 'sent'
    || normalizedStatus(row.followup_send_status) === 'sent'
  );
}

function relationshipSummary(profile) {
  const threads = [...profile.outreach_threads.values()];
  const statuses = new Set(threads.map((thread) => normalizedStatus(thread.review_status)).filter(Boolean));
  const accepted = profile.accepted_open_house_count > 0
    || [...statuses].some((status) => ACCEPTED_RELATIONSHIP_STATUSES.has(status));
  const interested = [...statuses].some((status) => INTERESTED_RELATIONSHIP_STATUSES.has(status));
  const priorOutreach = threads.some((thread) => thread.has_sent_outreach || thread.latest_reply_at);

  if (accepted) {
    return { category: 'accepted_worked', label: 'Accepted / worked with', priority: 0, has_prior_outreach: priorOutreach };
  }
  if (interested) {
    return { category: 'interested', label: 'Interested', priority: 1, has_prior_outreach: priorOutreach };
  }
  if (priorOutreach) {
    return { category: 'prior_outreach', label: 'Prior outreach', priority: 2, has_prior_outreach: true };
  }
  return { category: 'new', label: 'New agent', priority: 3, has_prior_outreach: false };
}

function buildAgentPerformance({
  agents = [],
  keys = [],
  outreach = [],
  inbox = [],
  leads = [],
  rankings = [],
  listingInventory = [],
  listingAgents = [],
  openHouses = [],
  fieldVisits = [],
  events = []
} = {}) {
  const profiles = [];
  const aliases = new Map();
  const keyCounts = countBy(keys.filter((row) => row.claimed), (row) => row.agent_slug);
  const openHouseById = new Map(openHouses.map((row) => [String(row.id), row]));
  const now = Date.now();

  function identityKeys(identity) {
    const values = [];
    const phone = phoneDigits(identity.phone_normalized || identity.phone);
    const email = normalizedEmail(identity.email);
    const name = String(identity.name || '').trim().toLowerCase();
    const brokerage = String(identity.brokerage || '').trim().toLowerCase();
    if (identity.agent_id) values.push(`agent:${identity.agent_id}`);
    if (identity.slug) values.push(`slug:${identity.slug}`);
    if (phone) values.push(`phone:${phone}`);
    if (email) values.push(`email:${email}`);
    if (name) values.push(`name:${name}|${brokerage}`);
    return values;
  }

  function ensureProfile(identity = {}, source = '') {
    const keysForIdentity = identityKeys(identity);
    let profile = keysForIdentity.map((key) => aliases.get(key)).find(Boolean);
    if (!profile) {
      profile = {
        id: identity.agent_id || '',
        agent_id: identity.agent_id || '',
        slug: identity.slug || '',
        ranking_id: identity.ranking_id || '',
        name: identity.name || '',
        phone: identity.phone || '',
        phone_normalized: phoneDigits(identity.phone_normalized || identity.phone),
        email: identity.email || '',
        brokerage: identity.brokerage || '',
        image_url: identity.image_url || '',
        website: identity.website || '',
        recommended_tier: identity.recommended_tier || '',
        agent_rank_score: Number(identity.agent_rank_score || 0),
        historical_open_house_count: Number(identity.historical_open_house_count || 0),
        accepted_open_house_count: 0,
        keychain_count: 0,
        reply_count: 0,
        lead_count: 0,
        sources: new Set(),
        outreach_threads: new Map(),
        listings: new Map(),
        upcoming_open_houses: new Map(),
        latest_activity: null
      };
      profiles.push(profile);
    }
    for (const field of ['agent_id', 'slug', 'ranking_id', 'name', 'phone', 'phone_normalized', 'email', 'brokerage', 'image_url', 'website', 'recommended_tier']) {
      if (!profile[field] && identity[field]) profile[field] = identity[field];
    }
    profile.agent_rank_score = Math.max(profile.agent_rank_score, Number(identity.agent_rank_score || 0));
    profile.historical_open_house_count = Math.max(
      profile.historical_open_house_count,
      Number(identity.historical_open_house_count || 0)
    );
    if (source) profile.sources.add(source);
    for (const key of identityKeys(profile)) aliases.set(key, profile);
    for (const key of keysForIdentity) aliases.set(key, profile);
    return profile;
  }

  function touch(profile, value) {
    if (!value) return;
    const time = new Date(value).getTime();
    const current = new Date(profile.latest_activity || 0).getTime();
    if (Number.isFinite(time) && time > current) profile.latest_activity = value;
  }

  function addListing(profile, row) {
    const key = String(row.source_listing_id || row.open_house_id || row.id || `${row.address || ''}|${row.open_start || ''}`);
    if (!key) return;
    profile.listings.set(key, {
      id: row.id || null,
      source_listing_id: row.source_listing_id || row.open_house_id || null,
      address: row.address || '',
      status: row.listing_status || '',
      price: row.price ?? null,
      image_url: row.image_url || row.listing_photo_url || row.image || '',
      listing_url: row.listing_url || row.link || '',
      last_seen_at: row.last_seen_at || row.updated_at || row.created_at || null
    });
  }

  function addUpcomingOpenHouse(profile, row, source) {
    const start = new Date(row.open_start || 0).getTime();
    const end = new Date(row.open_end || 0).getTime();
    const upcoming = Number.isFinite(start) && start > 0 && (
      start >= now || (Number.isFinite(end) && end >= now)
    );
    if (!upcoming) return;
    const key = String(row.open_house_id || row.source_listing_id || row.id || `${row.address || ''}|${row.open_start}`);
    profile.upcoming_open_houses.set(key, {
      id: row.open_house_id || row.id || null,
      source_listing_id: row.source_listing_id || row.open_house_id || row.id || null,
      queue_row_id: row.queue_row_id || (source === 'outreach' ? row.id : null),
      address: row.address || '',
      open_start: row.open_start,
      open_end: row.open_end || null,
      price: row.price ?? null,
      image_url: row.image_url || row.listing_photo_url || row.image || '',
      listing_url: row.listing_url || row.link || '',
      source
    });
  }

  for (const agent of agents) {
    const profile = ensureProfile({
      ...identityFrom(agent),
      agent_id: agent.id,
      slug: agent.slug,
      image_url: agent.image_url,
      website: agent.website
    }, 'claimed agent');
    profile.keychain_count = Math.max(profile.keychain_count, keyCounts[agent.slug] || 0);
  }

  for (const ranking of rankings) {
    const profile = ensureProfile({
      ...identityFrom(ranking),
      agent_id: ranking.agent_id,
      ranking_id: ranking.id,
      recommended_tier: ranking.recommended_tier,
      agent_rank_score: ranking.agent_rank_score,
      historical_open_house_count: ranking.open_house_count
    }, 'performance ranking');
    touch(profile, ranking.last_activity_at || ranking.updated_at);
  }

  for (const row of outreach) {
    const profile = ensureProfile({
      ...identityFrom(row, 'agent_'),
      image_url: row.agent_photo_url || ''
    }, 'outreach');
    profile.outreach_threads.set(String(row.id), {
      id: row.id,
      open_house_id: row.open_house_id || null,
      body: row.followup_sent_at ? row.followup_sms : row.selected_sms || '',
      review_status: row.review_status || 'pending',
      sent_at: row.followup_sent_at || row.initial_sent_at || row.last_outreach_at || row.created_at || null,
      has_sent_outreach: wasOutreachSent(row),
      address: row.address || ''
    });
    addListing(profile, row);
    addUpcomingOpenHouse(profile, row, 'outreach');
    touch(profile, row.followup_sent_at || row.initial_sent_at || row.last_outreach_at || row.created_at);
  }

  for (const row of inbox) {
    const profile = ensureProfile(identityFrom(row, 'agent_'), 'conversation');
    profile.reply_count += Math.max(1, Number(row.reply_count || 0));
    const threadId = String(row.queue_row_id || row.thread_key || '');
    if (threadId) {
      const existing = profile.outreach_threads.get(threadId) || {
        id: row.queue_row_id || row.thread_key,
        open_house_id: row.open_house_id || null,
        body: '',
        review_status: row.review_status || 'pending',
        sent_at: null,
        address: row.address || ''
      };
      profile.outreach_threads.set(threadId, {
        ...existing,
        review_status: existing.review_status || row.review_status,
        latest_reply_body: row.latest_reply_body || '',
        latest_reply_at: row.last_reply_at || null,
        latest_reply_direction: row.direction || null,
        reply_count: Number(row.reply_count || 0),
        opted_out: row.any_opt_out === true || row.latest_reply_opt_out === true
      });
    }
    touch(profile, row.last_reply_at);
  }

  for (const row of leads) {
    const profile = ensureProfile({
      slug: row.agent_slug || '',
      name: row.agent || '',
      phone: row.agent_phone || ''
    }, 'lead');
    profile.lead_count += 1;
    touch(profile, row.created_at);
  }

  for (const row of listingInventory) {
    const profile = ensureProfile(identityFrom(row, 'agent_'), 'listing inventory');
    addListing(profile, row);
    addUpcomingOpenHouse(profile, row, 'listing inventory');
    touch(profile, row.last_seen_at || row.updated_at);
  }

  for (const row of listingAgents) {
    const profile = ensureProfile({
      ...identityFrom(row),
      image_url: row.primary_photo_url || row.directory_photo_url || ''
    }, 'listing feed');
    const openHouse = openHouseById.get(String(row.open_house_id));
    if (openHouse) {
      addListing(profile, openHouse);
      addUpcomingOpenHouse(profile, { ...openHouse, open_house_id: openHouse.id }, 'listing feed');
      touch(profile, openHouse.updated_at || openHouse.created_at);
    }
    touch(profile, row.scraped_at || row.created_at);
  }

  for (const row of openHouses) {
    if (!row.agent && !row.agent_phone && !row.agent_email) continue;
    const profile = ensureProfile({
      name: row.agent,
      phone: row.agent_phone,
      email: row.agent_email,
      brokerage: row.brokerage
    }, 'open house feed');
    addListing(profile, row);
    addUpcomingOpenHouse(profile, { ...row, open_house_id: row.id }, 'open house feed');
    touch(profile, row.updated_at || row.created_at);
  }

  for (const row of fieldVisits) {
    if (!ACCEPTED_VISIT_STATUSES.has(normalizedStatus(row.status))) continue;
    const profile = ensureProfile(identityFrom(row, 'agent_'), 'accepted open house');
    profile.accepted_open_house_count += 1;
    touch(profile, row.confirmed_at || row.scheduled_start || row.updated_at || row.created_at);
  }

  for (const row of events) {
    if (!row.host_agent_slug || (!row.ended_at && !HOSTED_EVENT_STATUSES.has(normalizedStatus(row.status)))) continue;
    const profile = ensureProfile({ slug: row.host_agent_slug }, 'REL8TION event');
    profile.accepted_open_house_count += 1;
    touch(profile, row.ended_at || row.last_activity_at || row.start_time || row.created_at);
  }

  return profiles
    .map((profile) => {
      const upcoming = [...profile.upcoming_open_houses.values()]
        .sort((left, right) => new Date(left.open_start || 0) - new Date(right.open_start || 0));
      const threads = [...profile.outreach_threads.values()]
        .sort((left, right) => new Date(right.latest_reply_at || right.sent_at || 0) - new Date(left.latest_reply_at || left.sent_at || 0));
      const listings = [...profile.listings.values()]
        .sort((left, right) => new Date(right.last_seen_at || 0) - new Date(left.last_seen_at || 0));
      const relationship = relationshipSummary(profile);
      return {
        id: profile.id,
        agent_id: profile.agent_id,
        slug: profile.slug,
        ranking_id: profile.ranking_id,
        name: profile.name,
        phone: profile.phone,
        phone_normalized: profile.phone_normalized,
        email: profile.email,
        brokerage: profile.brokerage,
        image_url: profile.image_url,
        website: profile.website,
        recommended_tier: profile.recommended_tier,
        agent_rank_score: profile.agent_rank_score,
        keychain_count: profile.keychain_count,
        outreach_count: threads.length,
        reply_count: profile.reply_count,
        lead_count: profile.lead_count,
        listing_count: listings.length,
        upcoming_open_house_count: upcoming.length,
        historical_open_house_count: profile.historical_open_house_count,
        accepted_open_house_count: profile.accepted_open_house_count,
        relationship_category: relationship.category,
        relationship_label: relationship.label,
        relationship_priority: relationship.priority,
        has_prior_outreach: relationship.has_prior_outreach,
        listings,
        upcoming_open_houses: upcoming,
        outreach_threads: threads,
        latest_outreach: threads[0] || null,
        latest_queue_row_id: threads[0]?.id || null,
        latest_activity: profile.latest_activity,
        sources: [...profile.sources]
      };
    })
    .filter((profile) => profile.name || profile.phone || profile.email)
    .sort((left, right) => {
      const upcomingDelta = Number(right.upcoming_open_house_count > 0) - Number(left.upcoming_open_house_count > 0);
      if (upcomingDelta) return upcomingDelta;
      if (left.upcoming_open_house_count && right.upcoming_open_house_count) {
        const relationshipDelta = left.relationship_priority - right.relationship_priority;
        if (relationshipDelta) return relationshipDelta;
        const startDelta = new Date(left.upcoming_open_houses[0].open_start) - new Date(right.upcoming_open_houses[0].open_start);
        if (startDelta) return startDelta;
      }
      const activityDelta = new Date(right.latest_activity || 0) - new Date(left.latest_activity || 0);
      if (activityDelta) return activityDelta;
      return String(left.name || '').localeCompare(String(right.name || ''));
    });
}

module.exports = {
  buildAgentPerformance,
  phoneDigits,
  relationshipSummary,
  wasOutreachSent
};
