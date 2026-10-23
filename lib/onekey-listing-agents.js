const { usableAgentName, normalizedPhone } = require('./agent-identity');

const ORIGIN = 'https://www.onekeymls.com';
const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();

function listingAgentsFromRecord(record = {}) {
  const office = record.Listing?.AgentOffice || {};
  const seen = new Set();
  return [
    [office.ListAgent, office.ListOffice, 'ListAgent', true],
    [office.CoListAgent, office.CoListOffice || office.ListOffice, 'CoListAgent', false],
    [record.Listing?.ListAgent || record.Listing?.Agent, office.ListOffice, '', true]
  ].flatMap(([agent, brokerage, prefix, primary]) => {
    if (!agent) return [];
    const name = usableAgentName(agent[`${prefix}FullName`] || agent.FullName || agent.MemberFullName || agent.Name);
    if (!name) return [];
    const phone = clean(agent[`${prefix}DirectPhone`] || agent.MobilePhone || agent.CellPhone || agent.Phone);
    const email = clean(agent[`${prefix}Email`] || agent.Email);
    const key = name.toLowerCase();
    if (seen.has(key)) return [];
    seen.add(key);
    return [{
      name, phone, email,
      phone_normalized: normalizedPhone(phone),
      brokerage: clean(brokerage?.ListOfficeName || brokerage?.CoListOfficeName),
      is_primary: primary,
      open_house_id: record.UniqueListingId,
      source: 'onekey'
    }];
  });
}

// Decode JSON data only. Never execute scripts from the listing provider.
function propertyFromHtml(html, listingId) {
  const chunks = [];
  for (const match of html.matchAll(/self\.__next_f\.push\((\[[\s\S]*?\])\)\s*;?\s*<\/script>/g)) {
    try {
      const value = JSON.parse(match[1]);
      if (value[0] === 1 && typeof value[1] === 'string') chunks.push(value[1]);
    } catch (_) {}
  }
  const data = chunks.join('');
  for (const match of data.matchAll(/"property"\s*:\s*\{/g)) {
    const start = match.index + match[0].lastIndexOf('{');
    let depth = 0, quoted = false, escaped = false;
    for (let index = start; index < data.length; index += 1) {
      const char = data[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === '{') depth += 1;
      else if (char === '}' && --depth === 0) {
        try {
          const record = JSON.parse(data.slice(start, index + 1));
          if (record.UniqueListingId === listingId) return record;
        } catch (_) {}
        break;
      }
    }
  }
  return null;
}

async function sourceRequest(url, signal) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json,text/html', 'User-Agent': 'Mozilla/5.0 (compatible; Rel8tionListingAgent/1.0)' },
    signal,
    redirect: 'error'
  });
  if (!response.ok) throw new Error(`Listing agent source returned ${response.status}`);
  return response;
}

async function loadOneKeyListingAgents(house, { record = null, signal = AbortSignal.timeout(12000) } = {}) {
  if (!/^M\d+-[A-Za-z0-9]+$/.test(house?.id || '')) return [];
  if (record?.UniqueListingId !== house.id) record = null;
  if (!record) {
    if (house.lat == null || house.lng == null) return [];
    const lat = Number(house.lat), lng = Number(house.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return [];
    for (const offset of [0, 100, 200]) {
      const params = new URLSearchParams({
        topLeft: `[${lng - 0.01},${lat + 0.01}]`, bottomRight: `[${lng + 0.01},${lat - 0.01}]`,
        propertySaleType: 'Sale', StateOrProvince: 'NY', offset: String(offset)
      });
      const payload = await (await sourceRequest(`${ORIGIN}/api/search?${params}`, signal)).json();
      const rows = Array.isArray(payload?.Results) ? payload.Results : [];
      record = rows.find((row) => row.UniqueListingId === house.id);
      if (record || !rows.length || offset + rows.length >= Number(payload.Total || 0)) break;
    }
  }
  if (!record) return [];
  const inlineAgents = listingAgentsFromRecord(record);
  if (inlineAgents.length) return inlineAgents;
  if (!/^[A-Za-z0-9]+$/.test(record.BUPI || '')) return [];
  const slug = clean(record.DisplayName).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const url = `${ORIGIN}/home-details/${slug}/${record.BUPI}?uniqueListingId=${encodeURIComponent(house.id)}`;
  const html = await (await sourceRequest(url, signal)).text();
  const detail = propertyFromHtml(html, house.id);
  if (!detail) throw new Error('Listing agent source did not contain the selected MLS record');
  return listingAgentsFromRecord(detail);
}

module.exports = { listingAgentsFromRecord, propertyFromHtml, loadOneKeyListingAgents };
