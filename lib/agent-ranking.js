const { inferCountyFromRow } = require('./location-intelligence');

const FIELD_SYNONYMS = {
  agent_name: ['agent_name', 'agent', 'name', 'full_name', 'agent_full_name', 'listing_agent', 'salesperson'],
  first_name: ['first_name', 'firstname', 'first', 'agent_first_name'],
  last_name: ['last_name', 'lastname', 'last', 'agent_last_name'],
  brokerage: ['brokerage', 'company', 'agent_company', 'office', 'brokerage_name', 'firm', 'agency'],
  phone: ['phone', 'agent_phone', 'mobile', 'cell', 'telephone', 'phone_number'],
  email: ['email', 'agent_email', 'email_address', 'e_mail'],
  production_volume: ['production_volume', 'volume', 'sales_volume', 'closed_volume', 'total_volume', 'sold_volume'],
  transaction_count: ['transaction_count', 'transactions', 'units', 'sides', 'closed_sides', 'deals'],
  active_listing_count: ['active_listings', 'active_listing_count', 'listings', 'active_units', 'listings_active_total'],
  sold_listing_count: ['sold_listings', 'sold_listing_count', 'sold_units', 'closed_listings'],
  listings_days_since_last: ['listings_days_since_last', 'days_since_last_listing', 'listing_days_since_last', 'days_since_last'],
  listings_active_last_12_months: ['listings_active_last_12_months', 'active_listings_last_12_months', 'listings_last_12_months', 'listing_side_last_12_months'],
  buyside_last_90_days: ['buyside_last_90_days', 'buyer_side_last_90_days', 'buy_side_last_90_days', 'buyer_sides_90_days'],
  buyside_last_12_months: ['buyside_last_12_months', 'buyer_side_last_12_months', 'buy_side_last_12_months', 'buyer_sides_12_months'],
  average_price: ['average_price', 'avg_sale_price', 'average_sale_price', 'avg_listing_price', 'average_listing_price', 'avg_price'],
  market_area: ['market_area', 'market', 'area', 'region', 'territory', 'board_area', 'mls_area'],
  city: ['city', 'town', 'municipality'],
  county: ['county', 'agent_county', 'market_county', 'primary_county'],
  zip: ['zip', 'zipcode', 'postal_code', 'zip_code'],
  address: ['address', 'listing_address', 'property_address'],
  state: ['state', 'st']
};

const CANONICAL_FIELDS = Object.keys(FIELD_SYNONYMS);

function normalizeHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[%$#]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeName(value) {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ');
}

function normalizeEmail(value) {
  return cleanText(value).toLowerCase();
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  if (digits.length >= 10) return digits.slice(-10);
  return digits;
}

function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const text = String(value ?? '').trim();
  if (!text) return 0;
  const negative = /^\(.*\)$/.test(text);
  const cleaned = text.replace(/[,$%\s]/g, '').replace(/[()]/g, '');
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return 0;
  return negative ? -parsed : parsed;
}

function toInt(value) {
  return Math.max(0, Math.round(toNumber(value)));
}

function parseCsv(text) {
  const input = String(text || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(cell);
      if (row.some((value) => String(value || '').trim() !== '')) rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += char;
  }

  row.push(cell);
  if (row.some((value) => String(value || '').trim() !== '')) rows.push(row);
  return rows;
}

function detectMapping(headers, overrides = {}) {
  const normalizedHeaders = headers.map(normalizeHeader);
  const mapping = {};
  const used = new Set();

  for (const field of CANONICAL_FIELDS) {
    const override = overrides?.[field];
    if (override) {
      const overrideIndex = headers.findIndex((header) => header === override || normalizeHeader(header) === normalizeHeader(override));
      if (overrideIndex >= 0) {
        mapping[field] = { index: overrideIndex, source: headers[overrideIndex], confidence: 100, manual: true };
        used.add(overrideIndex);
        continue;
      }
    }

    const synonyms = FIELD_SYNONYMS[field] || [];
    const foundIndex = normalizedHeaders.findIndex((header) => synonyms.includes(header));
    if (foundIndex >= 0) {
      mapping[field] = { index: foundIndex, source: headers[foundIndex], confidence: 95, manual: false };
      used.add(foundIndex);
    }
  }

  const unmapped = headers.filter((_, index) => !used.has(index));
  return { mapping, unmapped, normalized_headers: normalizedHeaders };
}

function valueFor(row, mapping, field) {
  const item = mapping[field];
  if (!item || item.index < 0) return '';
  return cleanText(row[item.index]);
}

function splitName(fullName) {
  const clean = cleanText(fullName);
  if (!clean) return { first_name: '', last_name: '' };
  const parts = clean.split(/\s+/);
  return {
    first_name: parts[0] || '',
    last_name: parts.length > 1 ? parts.slice(1).join(' ') : ''
  };
}

function rowIdentity(row) {
  if (row.phone_normalized) return `phone:${row.phone_normalized}`;
  if (row.email) return `email:${row.email}`;
  return `name:${normalizeName(row.agent_name)}|${normalizeName(row.brokerage)}`;
}

function normalizeImportRows(csvText, options = {}) {
  const rows = parseCsv(csvText);
  if (!rows.length) {
    const error = new Error('The uploaded file did not contain any CSV rows.');
    error.status = 400;
    throw error;
  }

  const headers = rows[0].map(cleanText);
  const { mapping, unmapped, normalized_headers } = detectMapping(headers, options.column_overrides || {});
  const seen = new Map();
  const parsed = [];

  for (const rawRow of rows.slice(1)) {
    const raw = {};
    headers.forEach((header, index) => {
      raw[header || `column_${index + 1}`] = rawRow[index] ?? '';
    });

    const explicitName = valueFor(rawRow, mapping, 'agent_name');
    const firstName = valueFor(rawRow, mapping, 'first_name');
    const lastName = valueFor(rawRow, mapping, 'last_name');
    const split = splitName(explicitName || `${firstName} ${lastName}`);
    const agentName = cleanText(explicitName || `${firstName || split.first_name} ${lastName || split.last_name}`);
    const phone = valueFor(rawRow, mapping, 'phone');
    const email = normalizeEmail(valueFor(rawRow, mapping, 'email'));

    const listings12 = toInt(valueFor(rawRow, mapping, 'listings_active_last_12_months'));
    const buyside12 = toInt(valueFor(rawRow, mapping, 'buyside_last_12_months'));
    const explicitTransactions = toInt(valueFor(rawRow, mapping, 'transaction_count'));
    const location = inferCountyFromRow({
      county: valueFor(rawRow, mapping, 'county'),
      city: valueFor(rawRow, mapping, 'city'),
      zip: valueFor(rawRow, mapping, 'zip'),
      state: valueFor(rawRow, mapping, 'state') || options.default_state,
      address: valueFor(rawRow, mapping, 'address'),
      market_area: valueFor(rawRow, mapping, 'market_area') || cleanText(options.market_area || options.default_market_area)
    }, {
      defaultCounty: options.default_county,
      defaultMarketArea: options.default_market_area || options.market_area,
      defaultState: options.default_state || 'NY',
      applyDefault: options.apply_location_defaults !== false,
      tryInference: options.try_county_inference !== false
    });

    const normalized = {
      agent_name: agentName,
      first_name: cleanText(firstName || split.first_name),
      last_name: cleanText(lastName || split.last_name),
      brokerage: valueFor(rawRow, mapping, 'brokerage'),
      phone,
      phone_normalized: normalizePhone(phone),
      email,
      market_area: location.market_area,
      city: location.city,
      county: location.county,
      primary_county: location.primary_county,
      inferred_county: location.inferred_county,
      zip: location.zip,
      state: location.state,
      location_confidence: location.location_confidence,
      location_source: location.location_source,
      production_volume: Math.max(0, toNumber(valueFor(rawRow, mapping, 'production_volume'))),
      transaction_count: explicitTransactions || listings12 + buyside12,
      active_listing_count: toInt(valueFor(rawRow, mapping, 'active_listing_count')),
      sold_listing_count: toInt(valueFor(rawRow, mapping, 'sold_listing_count')),
      listings_days_since_last: toInt(valueFor(rawRow, mapping, 'listings_days_since_last')),
      listings_active_last_12_months: listings12,
      buyside_last_90_days: toInt(valueFor(rawRow, mapping, 'buyside_last_90_days')),
      buyside_last_12_months: buyside12,
      average_price: Math.max(0, toNumber(valueFor(rawRow, mapping, 'average_price'))),
      raw
    };

    if (!normalized.agent_name && !normalized.phone_normalized && !normalized.email) continue;
    const identity = rowIdentity(normalized);
    normalized.duplicate_key = identity;
    normalized.is_duplicate = seen.has(identity);
    seen.set(identity, (seen.get(identity) || 0) + 1);
    parsed.push(normalized);
  }

  const duplicates = parsed.filter((row) => seen.get(row.duplicate_key) > 1).length;
  return {
    headers,
    normalized_headers,
    mapping,
    unmapped_columns: unmapped,
    rows: parsed,
    row_count: parsed.length,
    duplicate_count: duplicates
  };
}

function tokenSet(value) {
  return new Set(normalizeName(value).split(' ').filter(Boolean));
}

function tokenSimilarity(a, b) {
  const first = tokenSet(a);
  const second = tokenSet(b);
  if (!first.size || !second.size) return 0;
  let overlap = 0;
  for (const token of first) {
    if (second.has(token)) overlap += 1;
  }
  return overlap / Math.max(first.size, second.size);
}

function matchImportedRows(rows, agents = []) {
  const byPhone = new Map();
  const byEmail = new Map();
  for (const agent of agents || []) {
    const phone = normalizePhone(agent.phone_normalized || agent.phone);
    const email = normalizeEmail(agent.email);
    if (phone) byPhone.set(phone, agent);
    if (email) byEmail.set(email, agent);
  }

  return rows.map((row) => {
    let matched = null;
    let confidence = 0;
    let reason = '';

    if (row.phone_normalized && byPhone.has(row.phone_normalized)) {
      matched = byPhone.get(row.phone_normalized);
      confidence = 100;
      reason = 'phone';
    } else if (row.email && byEmail.has(row.email)) {
      matched = byEmail.get(row.email);
      confidence = 95;
      reason = 'email';
    } else {
      let best = { agent: null, score: 0 };
      for (const agent of agents || []) {
        const nameScore = tokenSimilarity(row.agent_name, agent.name);
        const brokerageScore = tokenSimilarity(row.brokerage, agent.brokerage);
        const score = Math.round((nameScore * 70) + (brokerageScore * 30));
        if (score > best.score) best = { agent, score };
      }
      if (best.agent && best.score >= 75) {
        matched = best.agent;
        confidence = Math.min(90, best.score);
        reason = 'name_brokerage';
      } else if (best.agent && best.score >= 55) {
        matched = best.agent;
        confidence = best.score;
        reason = 'needs_review';
      }
    }

    return {
      ...row,
      matched_agent_id: matched?.id || null,
      matched_agent_name: matched?.name || null,
      match_confidence: confidence,
      match_reason: reason || 'unmatched',
      needs_review: confidence > 0 && confidence < 75
    };
  });
}

function average(rows, field) {
  const values = rows.map((row) => Number(row[field] || 0)).filter((value) => Number.isFinite(value) && value > 0);
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function marketAverages(rows) {
  return {
    average_production_volume: average(rows, 'production_volume'),
    average_transaction_count: average(rows, 'transaction_count'),
    average_price: average(rows, 'average_price'),
    average_active_listings: average(rows, 'active_listing_count'),
    average_listing_side_12_months: average(rows, 'listings_active_last_12_months'),
    average_buyside_12_months: average(rows, 'buyside_last_12_months'),
    average_days_since_last_listing: average(rows, 'listings_days_since_last'),
    average_open_house_count: average(rows, 'open_house_count')
  };
}

function hasWeekendOpenHouse(row, now = new Date()) {
  if (row.has_open_house_this_weekend) return true;
  return false;
}

function hasListReportsSignal(row) {
  return Boolean(
    Number(row.active_listing_count || 0) ||
    Number(row.listings_active_last_12_months || 0) ||
    Number(row.buyside_last_90_days || 0) ||
    Number(row.buyside_last_12_months || 0)
  );
}

function tierForScore(score, row) {
  if (!row.agent_name && !row.production_volume && !row.transaction_count && !hasListReportsSignal(row)) return 'Unknown';
  if (score >= 260) return 'A+';
  if (score >= 160) return 'A';
  if (score >= 80) return 'B';
  if (score > 0) return 'C';
  return 'Unknown';
}

function money(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return '$0';
  if (number >= 1000000) return `$${(number / 1000000).toFixed(number >= 10000000 ? 0 : 1)}M`;
  if (number >= 1000) return `$${Math.round(number / 1000)}K`;
  return `$${Math.round(number)}`;
}

function buildGapSummary(row, averages) {
  if (Number(row.matched_weekend_open_house_count || 0) > 0) {
    return 'This agent has matched open-house activity this weekend, creating an immediate buyer-capture opportunity for Rel8tion.';
  }
  if (Number(row.matched_open_house_count || 0) > 0) {
    return 'This agent has current matched Rel8tion open-house activity, so outreach should focus on capturing buyers from active listing traffic.';
  }
  const activeListings = Number(row.active_listing_count || 0);
  const listingSide12 = Number(row.listings_active_last_12_months || 0);
  const buySide12 = Number(row.buyside_last_12_months || 0);
  const daysSince = Number(row.listings_days_since_last || 0);
  if (activeListings > 0 && daysSince > 0 && daysSince <= 45) {
    return 'This agent has active inventory and recent listing activity, making them a strong fit for immediate open-house buyer capture.';
  }
  if (listingSide12 > 0 || buySide12 > 0) {
    return 'This agent has measurable listing or buyside activity in the last 12 months. REL8TION should position around capturing buyers from the business they are already creating.';
  }
  if (row.production_volume > averages.average_production_volume && row.open_house_count > 0) {
    return 'This agent is producing above the report average and is active enough that missed open-house buyer capture has real revenue impact.';
  }
  if (row.active_listing_count > 0 || row.open_house_count > 0) {
    return 'This agent has active listing activity, but the buyer capture workflow may still depend on paper sign-ins, manual follow-up, or tools buyers and busy agents ignore.';
  }
  if (row.average_price > averages.average_price && row.average_price > 0) {
    return 'This agent works at a meaningful price point where every untracked buyer conversation matters.';
  }
  return 'The report has limited production signals, so REL8TION should start with a lightweight Event Pass or kit conversation before assuming fit.';
}

function buildValueSummary(row) {
  return [
    'Rel8tion closes the gap with a physical smart sign and Rel8tionChip that are already branded and ready.',
    'Buyers tap or scan, complete check-in and disclosures, and the agent gets instant SMS visibility without learning another dashboard.',
    row.open_house_count > 0 || row.has_open_house_this_weekend
      ? 'Because this agent already attracts open-house traffic, Rel8tion can capture the buyers they are already bringing through the door.'
      : 'The no-setup hardware makes this a low-friction first step even before a heavier software workflow exists.'
  ].join(' ');
}

function buildPitch(row) {
  const first = splitName(row.agent_name).first_name || 'there';
  return `${first}, you are already producing. Rel8tion is not asking you to learn another tech platform. We give you a branded open house kit that captures buyers, sends instant follow-up, handles disclosures, and connects financing support with a tap or scan. You focus on the open house. The system handles the rest.`;
}

function nextBestAction(row, tier) {
  if (Number(row.matched_weekend_open_house_count || 0) > 0) return 'Prioritize this weekend open-house capture outreach.';
  if (Number(row.matched_open_house_count || 0) > 0) return 'Send matched open-house Event Pass intro.';
  if (Number(row.active_listing_count || 0) > 0 && Number(row.listings_days_since_last || 0) <= 45) {
    return 'Prioritize next-listing/open-house kit outreach.';
  }
  if (tier === 'A+') return 'Prioritize owner-led outreach with ListReports activity pitch.';
  if (tier === 'A') return 'Send active-listing open house kit intro.';
  if (tier === 'B') return 'Offer Event Pass or starter kit for next active listing.';
  if (tier === 'C') return 'Nurture with no-setup Event Pass explanation.';
  return 'Review data quality before outreach.';
}

function scoreRow(row, averages = {}) {
  const openHouseCount = Number(row.open_house_count || 0);
  const activeListings = Number(row.active_listing_count || 0);
  const listingSide12 = Number(row.listings_active_last_12_months || 0);
  const buySide90 = Number(row.buyside_last_90_days || 0);
  const buySide12 = Number(row.buyside_last_12_months || 0);
  const daysSince = Number(row.listings_days_since_last || 0);
  const matchedOpenHouses = Number(row.matched_open_house_count || row.open_house_count || 0);
  const matchedWeekend = Number(row.matched_weekend_open_house_count || 0);
  const matchedActiveListings = Number(row.matched_active_listing_count || 0);
  const freshListingScore = daysSince > 0 && daysSince <= 30 ? 35 : daysSince <= 90 ? 24 : daysSince <= 180 ? 12 : 0;
  const productionScore =
    (Number(row.transaction_count || 0) * 20) +
    (Number(row.production_volume || 0) / 100000) +
    (activeListings * 25) +
    (listingSide12 * 28) +
    (buySide90 * 18) +
    (buySide12 * 12) +
    freshListingScore +
    (Number(row.sold_listing_count || 0) * 20) +
    (Number(row.average_price || 0) / 100000) +
    (openHouseCount * 25);
  const rel8tionActivityScore =
    (matchedActiveListings * 15) +
    (matchedOpenHouses * 25) +
    (matchedWeekend * 50);

  const highProduction = Number(row.production_volume || 0) > Number(averages.average_production_volume || 0);
  const highTransactions = Number(row.transaction_count || 0) > Number(averages.average_transaction_count || 0);
  const strongPrice = Number(row.average_price || 0) > Number(averages.average_price || 0);
  const aboveListingSide = listingSide12 > Number(averages.average_listing_side_12_months || 0);
  const aboveBuySide = buySide12 > Number(averages.average_buyside_12_months || 0);
  const contactScore = (row.phone_normalized ? 12 : 0) + (row.email ? 6 : 0);
  const openHouseBoost = row.has_open_house_this_weekend ? 35 : matchedOpenHouses > 0 ? 24 : openHouseCount > 0 ? 18 : 0;
  const gapScore =
    (productionScore * 0.4) +
    (rel8tionActivityScore * 0.6) +
    (highProduction ? 40 : 0) +
    (highTransactions ? 25 : 0) +
    (aboveListingSide ? 30 : 0) +
    (aboveBuySide ? 20 : 0) +
    (strongPrice ? 20 : 0) +
    (activeListings > 0 ? 25 : 0) +
    freshListingScore +
    openHouseBoost +
    (row.phone_normalized || row.email ? 10 : 0);
  const captureScore = Math.max(0, Math.min(100, 100 - gapScore + (openHouseCount ? 10 : 0)));
  const locationScore = Number(row.location_confidence || 0) / 10;
  const score = Math.round(productionScore + rel8tionActivityScore + locationScore + contactScore);
  const tier = tierForScore(score, row);

  return {
    rel8tion_lead_capture_score: Math.round(captureScore),
    opportunity_gap_score: Math.round(gapScore),
    agent_rank_score: score,
    recommended_tier: tier,
    recommended_pitch: buildPitch(row),
    next_best_action: nextBestAction(row, tier),
    gap_summary: buildGapSummary(row, averages),
    rel8tion_value_summary: buildValueSummary(row),
    above_average_volume: highProduction,
    above_average_transactions: highTransactions,
    above_average_listing_side_12_months: aboveListingSide,
    above_average_buyside_12_months: aboveBuySide,
    above_average_price: strongPrice,
    below_average_capture_opportunity: gapScore >= 55,
    labels: [
      highProduction ? 'Above Market Average Producer' : '',
      highProduction && gapScore >= 55 ? 'High Production / High Gap' : '',
      activeListings > 0 ? 'Active Listing Inventory' : '',
      freshListingScore >= 24 ? 'Recent Listing Activity' : '',
      listingSide12 > 0 ? 'Listing Side Activity' : '',
      buySide90 > 0 || buySide12 > 0 ? 'Buyside Activity' : '',
      matchedOpenHouses > 0 ? 'Open House Match' : '',
      matchedWeekend > 0 ? 'Weekend Open House' : '',
      !row.primary_county ? 'Needs Location Review' : '',
      openHouseCount > 0 || row.has_open_house_this_weekend ? 'Strong Open House Candidate' : '',
      activeListings > 0 && !openHouseCount ? 'Underutilized Producer' : '',
      tier === 'C' ? 'Emerging Agent' : '',
      tier === 'B' || tier === 'C' ? 'Needs Rel8tion Event Pass First' : ''
    ].filter(Boolean)
  };
}

function rankingFromImportRow(importRow, averages = {}, signals = {}) {
  const signal = signals[importRow.phone_normalized] || signals[normalizeName(importRow.agent_name)] || {};
  const row = {
    ...importRow,
    open_house_count: Number(signal.open_house_count || 0),
    has_open_house_this_weekend: Boolean(signal.has_open_house_this_weekend)
  };
  const scored = scoreRow(row, averages);
  return {
    agent_id: importRow.matched_agent_id || null,
    latest_import_row_id: importRow.id || null,
    agent_name: importRow.agent_name || null,
    brokerage: importRow.brokerage || null,
    phone: importRow.phone || null,
    phone_normalized: importRow.phone_normalized || null,
    email: importRow.email || null,
    market_area: importRow.market_area || null,
    county: importRow.county || null,
    primary_county: importRow.primary_county || importRow.county || null,
    city: importRow.city || null,
    state: importRow.state || null,
    zip: importRow.zip || null,
    inferred_county: importRow.inferred_county || null,
    location_confidence: importRow.location_confidence || 0,
    location_source: importRow.location_source || 'missing',
    production_volume: importRow.production_volume || 0,
    transaction_count: importRow.transaction_count || 0,
    active_listing_count: importRow.active_listing_count || 0,
    sold_listing_count: importRow.sold_listing_count || 0,
    listings_days_since_last: importRow.listings_days_since_last || 0,
    listings_active_last_12_months: importRow.listings_active_last_12_months || 0,
    buyside_last_90_days: importRow.buyside_last_90_days || 0,
    buyside_last_12_months: importRow.buyside_last_12_months || 0,
    average_price: importRow.average_price || 0,
    open_house_count: row.open_house_count || 0,
    matched_open_house_count: row.matched_open_house_count || row.open_house_count || 0,
    matched_weekend_open_house_count: row.matched_weekend_open_house_count || 0,
    matched_active_listing_count: row.matched_active_listing_count || 0,
    matched_open_house_ids: row.matched_open_house_ids || [],
    last_matched_open_house_at: row.last_matched_open_house_at || null,
    rel8tion_lead_capture_score: scored.rel8tion_lead_capture_score,
    opportunity_gap_score: scored.opportunity_gap_score,
    agent_rank_score: scored.agent_rank_score,
    recommended_tier: scored.recommended_tier,
    recommended_pitch: scored.recommended_pitch,
    next_best_action: scored.next_best_action,
    gap_summary: scored.gap_summary,
    rel8tion_value_summary: scored.rel8tion_value_summary,
    has_open_house_this_weekend: row.has_open_house_this_weekend,
    has_phone: Boolean(importRow.phone_normalized),
    has_email: Boolean(importRow.email),
    last_activity_at: signal.last_activity_at || null,
    raw_sources: {
      labels: scored.labels,
      above_average_volume: scored.above_average_volume,
      above_average_transactions: scored.above_average_transactions,
      above_average_listing_side_12_months: scored.above_average_listing_side_12_months,
      above_average_buyside_12_months: scored.above_average_buyside_12_months,
      above_average_price: scored.above_average_price,
      below_average_capture_opportunity: scored.below_average_capture_opportunity,
      match_confidence: importRow.match_confidence || 0,
      match_reason: importRow.match_reason || 'unmatched',
      needs_location_review: !importRow.primary_county && !importRow.county,
      duplicate_key: importRow.duplicate_key || null
    }
  };
}

function buildPitchVariants(ranking) {
  const first = splitName(ranking.agent_name).first_name || 'there';
  const brokerage = ranking.brokerage ? ` at ${ranking.brokerage}` : '';
  const market = ranking.market_area ? ` in ${ranking.market_area}` : '';
  return {
    soft_intro: `Hi ${first}, saw your production activity${market}. Rel8tion is a no-setup open house kit: buyers tap or scan, check in, disclosures are handled, and you get instant lead visibility. No app or password for you to manage.`,
    production_focused: `${first}, you are already producing${brokerage}. Rel8tion helps capture the buyers your listings already attract with a branded smart sign, instant SMS, disclosures, and follow-up without adding another platform to learn.`,
    open_house_kit_focused: `For your next open house, Rel8tion can give you a physical branded kit that is already live. Buyers tap or scan, you get the lead, and the system handles the recap and follow-up.`,
    broker_team_focused: `Rel8tion gives busy agents and teams a repeatable buyer-capture workflow without asking anyone to print QR codes, remember links, create logins, or learn another dashboard.`,
    luxury_agent_focused: `At your price point, every missed open-house buyer matters. Rel8tion keeps the experience simple and polished: branded hardware, instant buyer capture, disclosures, and financing support when needed.`
  };
}

function outreachPayloadFromRanking(ranking) {
  const variants = buildPitchVariants(ranking);
  return {
    agent_name: ranking.agent_name || '',
    agent_phone: ranking.phone || '',
    agent_phone_normalized: ranking.phone_normalized || normalizePhone(ranking.phone),
    agent_email: ranking.email || '',
    brokerage: ranking.brokerage || '',
    city: ranking.market_area || '',
    source: 'agent_ranking',
    template_key: 'agent_ranking',
    sms_variant_1: variants.soft_intro,
    sms_variant_2: variants.production_focused,
    sms_variant_3: variants.open_house_kit_focused,
    selected_sms: variants.production_focused,
    review_status: 'agent_ranking',
    generation_status: 'generated',
    mockup_status: 'not_required',
    send_mode: 'manual',
    initial_send_status: 'not_queued',
    followup_send_status: 'not_scheduled',
    followup_block_reason: 'followups_disabled',
    report_note: [
      `Agent Ranking tier: ${ranking.recommended_tier || 'Unknown'}.`,
      `ListReports activity: ${ranking.active_listing_count || 0} active listings, ${ranking.listings_active_last_12_months || 0} listing-side 12m, ${ranking.buyside_last_90_days || 0} buyside 90d, ${ranking.buyside_last_12_months || 0} buyside 12m.`,
      `Location: ${ranking.primary_county || ranking.county || 'Needs review'}${ranking.market_area ? ` / ${ranking.market_area}` : ''}. Matched open houses: ${ranking.matched_open_house_count || 0}, weekend: ${ranking.matched_weekend_open_house_count || 0}.`,
      ranking.gap_summary || '',
      ranking.recommended_pitch || ''
    ].filter(Boolean).join('\n')
  };
}

module.exports = {
  CANONICAL_FIELDS,
  FIELD_SYNONYMS,
  buildPitchVariants,
  detectMapping,
  marketAverages,
  normalizeEmail,
  normalizeHeader,
  normalizeImportRows,
  normalizeName,
  normalizePhone,
  matchImportedRows,
  money,
  outreachPayloadFromRanking,
  parseCsv,
  rankingFromImportRow,
  rowIdentity,
  scoreRow,
  tokenSimilarity
};
