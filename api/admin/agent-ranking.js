const { adminAuthorized, assertAdminConfig, sendJson, supabaseRest } = require('../../lib/admin-auth');
const {
  buildPitchVariants,
  marketAverages,
  matchImportedRows,
  normalizeImportRows,
  normalizeName,
  normalizePhone,
  outreachPayloadFromRanking,
  rankingFromImportRow
} = require('../../lib/agent-ranking');

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  try {
    return JSON.parse(req.body);
  } catch (_) {
    return {};
  }
}

function enc(value) {
  return encodeURIComponent(String(value ?? '').trim());
}

function one(rows) {
  return Array.isArray(rows) ? rows[0] || null : null;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function clampLimit(value, fallback = 750, max = 2000) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(Math.floor(parsed), max));
}

function readQuery(req, name) {
  const value = req.query?.[name];
  if (Array.isArray(value)) return value[0] || '';
  if (value) return value;
  try {
    return new URL(req.url || '', 'https://rel8tion.local').searchParams.get(name) || '';
  } catch (_) {
    return '';
  }
}

function uploadMetadata(body, auth) {
  return {
    source_name: String(body.source_name || 'Manual Upload').trim(),
    market_area: String(body.market_area || '').trim() || null,
    period_start: body.period_start || null,
    period_end: body.period_end || null,
    original_filename: String(body.original_filename || '').trim() || null,
    notes: String(body.notes || '').trim() || null,
    uploaded_by: isUuid(auth.uid) ? auth.uid : null
  };
}

function assertCsvUpload(body) {
  const filename = String(body.original_filename || '').toLowerCase();
  if (filename.endsWith('.xlsx') || filename.endsWith('.xls')) {
    const error = new Error('CSV import is enabled. XLSX support needs a package-backed parser before it can be safely finalized server-side.');
    error.status = 415;
    throw error;
  }
  if (!String(body.file_text || '').trim()) {
    const error = new Error('Missing CSV file contents.');
    error.status = 400;
    throw error;
  }
}

async function loadAgents() {
  return supabaseRest('agents?select=id,name,brokerage,phone,phone_normalized,email&order=name.asc&limit=5000')
    .catch(() => []);
}

function weekendRange(now = new Date()) {
  const start = new Date(now);
  const day = start.getDay();
  const daysUntilSaturday = (6 - day + 7) % 7;
  start.setDate(start.getDate() + daysUntilSaturday);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 3);
  end.setHours(3, 0, 0, 0);
  return { start, end };
}

async function loadOpenHouseSignals() {
  const now = new Date();
  const { start, end } = weekendRange(now);
  const rows = await supabaseRest(
    `agent_outreach_queue?select=agent_name,agent_phone,agent_phone_normalized,open_start,open_end,last_outreach_at,created_at&open_start=gte.${enc(now.toISOString())}&order=open_start.asc.nullslast&limit=5000`
  ).catch(() => []);
  const signals = {};
  for (const row of rows || []) {
    const keys = [
      normalizePhone(row.agent_phone_normalized || row.agent_phone),
      normalizeName(row.agent_name)
    ].filter(Boolean);
    const openStart = row.open_start ? new Date(row.open_start) : null;
    const isWeekend = Boolean(openStart && openStart >= start && openStart < end);
    for (const key of keys) {
      if (!signals[key]) {
        signals[key] = {
          open_house_count: 0,
          has_open_house_this_weekend: false,
          last_activity_at: null
        };
      }
      signals[key].open_house_count += 1;
      signals[key].has_open_house_this_weekend = signals[key].has_open_house_this_weekend || isWeekend;
      const activity = row.last_outreach_at || row.open_start || row.created_at || null;
      if (activity && (!signals[key].last_activity_at || new Date(activity) > new Date(signals[key].last_activity_at))) {
        signals[key].last_activity_at = activity;
      }
    }
  }
  return signals;
}

async function parseAndMatch(body) {
  assertCsvUpload(body);
  const parsed = normalizeImportRows(body.file_text, {
    market_area: body.market_area,
    column_overrides: body.column_overrides || {}
  });
  const agents = await loadAgents();
  const matchedRows = matchImportedRows(parsed.rows, agents);
  const matchedCount = matchedRows.filter((row) => row.matched_agent_id).length;
  const needsReviewCount = matchedRows.filter((row) => row.needs_review).length;
  return {
    ...parsed,
    rows: matchedRows,
    matched_count: matchedCount,
    unmatched_count: matchedRows.length - matchedCount,
    needs_review_count: needsReviewCount
  };
}

function importRowPayload(uploadId, row) {
  return {
    upload_id: uploadId,
    matched_agent_id: row.matched_agent_id || null,
    agent_name: row.agent_name || null,
    first_name: row.first_name || null,
    last_name: row.last_name || null,
    brokerage: row.brokerage || null,
    phone: row.phone || null,
    phone_normalized: row.phone_normalized || null,
    email: row.email || null,
    market_area: row.market_area || null,
    city: row.city || null,
    county: row.county || null,
    state: row.state || null,
    production_volume: row.production_volume || 0,
    transaction_count: row.transaction_count || 0,
    active_listing_count: row.active_listing_count || 0,
    sold_listing_count: row.sold_listing_count || 0,
    average_price: row.average_price || 0,
    raw: {
      ...(row.raw || {}),
      duplicate_key: row.duplicate_key || null,
      is_duplicate: Boolean(row.is_duplicate),
      match_reason: row.match_reason || 'unmatched',
      needs_review: Boolean(row.needs_review)
    },
    match_confidence: row.match_confidence || 0
  };
}

async function insertRows(table, rows, chunkSize = 200) {
  const inserted = [];
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize);
    if (!chunk.length) continue;
    const result = await supabaseRest(table, {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(chunk)
    });
    inserted.push(...(Array.isArray(result) ? result : []));
  }
  return inserted;
}

function rankingIdentity(row) {
  if (row.agent_id) return `agent:${row.agent_id}`;
  if (row.phone_normalized) return `phone:${row.phone_normalized}`;
  if (row.email) return `email:${String(row.email).toLowerCase()}`;
  return `name:${normalizeName(row.agent_name)}|${normalizeName(row.brokerage)}`;
}

async function upsertRankings(rankings) {
  const existing = await supabaseRest('agent_rankings?select=id,agent_id,phone_normalized,email,agent_name,brokerage&limit=10000')
    .catch(() => []);
  const existingMap = new Map((existing || []).map((row) => [rankingIdentity(row), row]));
  const created = [];
  const updated = [];
  const toCreate = [];

  for (const ranking of rankings) {
    const match = existingMap.get(rankingIdentity(ranking));
    if (match?.id) {
      const patched = one(await supabaseRest(`agent_rankings?id=eq.${enc(match.id)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(ranking)
      }));
      if (patched) updated.push(patched);
    } else {
      toCreate.push(ranking);
    }
  }

  created.push(...await insertRows('agent_rankings', toCreate, 100));
  return { created, updated };
}

function summarizeRankings(rankings) {
  const totalVolume = rankings.reduce((sum, row) => sum + Number(row.production_volume || 0), 0);
  const missingCapture = rankings.filter((row) => Number(row.opportunity_gap_score || 0) >= 55).length;
  return {
    total_agents_analyzed: rankings.length,
    a_plus_agents: rankings.filter((row) => row.recommended_tier === 'A+').length,
    a_tier_agents: rankings.filter((row) => row.recommended_tier === 'A').length,
    total_production_volume_imported: totalVolume,
    average_agent_production: rankings.length ? totalVolume / rankings.length : 0,
    agents_with_open_houses_this_weekend: rankings.filter((row) => row.has_open_house_this_weekend).length,
    agents_missing_buyer_capture_opportunity: missingCapture
  };
}

async function handlePreview(body) {
  const parsed = await parseAndMatch(body);
  return {
    headers: parsed.headers,
    mapping: parsed.mapping,
    unmapped_columns: parsed.unmapped_columns,
    row_count: parsed.row_count,
    duplicate_count: parsed.duplicate_count,
    matched_count: parsed.matched_count,
    unmatched_count: parsed.unmatched_count,
    needs_review_count: parsed.needs_review_count,
    preview_rows: parsed.rows.slice(0, 20)
  };
}

async function handleConfirm(body, auth) {
  const parsed = await parseAndMatch(body);
  const metadata = uploadMetadata(body, auth);
  const upload = one(await supabaseRest('agent_production_uploads', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      ...metadata,
      row_count: parsed.row_count,
      raw_metadata: {
        mapping: parsed.mapping,
        unmapped_columns: parsed.unmapped_columns,
        duplicate_count: parsed.duplicate_count,
        matched_count: parsed.matched_count,
        unmatched_count: parsed.unmatched_count,
        needs_review_count: parsed.needs_review_count
      }
    })
  }));

  const importRows = await insertRows(
    'agent_production_import_rows',
    parsed.rows.map((row) => importRowPayload(upload.id, row))
  );
  const signals = await loadOpenHouseSignals();
  const avgs = marketAverages(importRows);
  const rankings = importRows.map((row) => {
    const ranking = rankingFromImportRow(row, avgs, signals);
    ranking.raw_sources = {
      ...(ranking.raw_sources || {}),
      upload_id: upload.id,
      source_name: upload.source_name || null,
      source_upload_id: upload.id,
      period_start: upload.period_start || null,
      period_end: upload.period_end || null,
      original_filename: upload.original_filename || null
    };
    return ranking;
  });
  const upserted = await upsertRankings(rankings);
  const savedRankings = [...upserted.updated, ...upserted.created].sort((a, b) => Number(b.agent_rank_score || 0) - Number(a.agent_rank_score || 0));

  return {
    upload,
    imported_rows: importRows.length,
    rankings_created: upserted.created.length,
    rankings_updated: upserted.updated.length,
    summary: summarizeRankings(savedRankings),
    top_rankings: savedRankings.slice(0, 20)
  };
}

async function handleList(req) {
  const limit = clampLimit(readQuery(req, 'limit'));
  const [rankings, uploads] = await Promise.all([
    supabaseRest(`agent_rankings?select=*&order=agent_rank_score.desc,updated_at.desc&limit=${limit}`).catch(() => []),
    supabaseRest('agent_production_uploads?select=*&order=created_at.desc&limit=50').catch(() => [])
  ]);
  return {
    rankings,
    uploads,
    summary: summarizeRankings(rankings || []),
    loaded_at: new Date().toISOString()
  };
}

async function findRanking(id) {
  const ranking = one(await supabaseRest(`agent_rankings?id=eq.${enc(id)}&select=*&limit=1`));
  if (!ranking) {
    const error = new Error('Agent ranking not found.');
    error.status = 404;
    throw error;
  }
  return ranking;
}

async function handleAddToOutreach(body) {
  const ranking = await findRanking(body.ranking_id);
  const payload = outreachPayloadFromRanking(ranking);
  const phone = normalizePhone(payload.agent_phone_normalized || payload.agent_phone);
  let existing = null;
  if (phone) {
    existing = one(await supabaseRest(`agent_outreach_queue?source=eq.agent_ranking&agent_phone_normalized=eq.${enc(phone)}&select=id&limit=1`).catch(() => []));
  }
  if (!existing && ranking.email) {
    existing = one(await supabaseRest(`agent_outreach_queue?source=eq.agent_ranking&agent_email=eq.${enc(ranking.email)}&select=id&limit=1`).catch(() => []));
  }
  if (!existing && ranking.agent_name) {
    existing = one(await supabaseRest(`agent_outreach_queue?source=eq.agent_ranking&agent_name=eq.${enc(ranking.agent_name)}&select=id&limit=1`).catch(() => []));
  }

  const queue = existing?.id
    ? one(await supabaseRest(`agent_outreach_queue?id=eq.${enc(existing.id)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(payload)
      }))
    : one(await supabaseRest('agent_outreach_queue', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(payload)
      }));

  return { ranking, queue, variants: buildPitchVariants(ranking) };
}

async function handleGeneratePitch(body) {
  const ranking = await findRanking(body.ranking_id);
  return { ranking_id: ranking.id, variants: buildPitchVariants(ranking), recommended_pitch: ranking.recommended_pitch };
}

async function handleNotFit(body) {
  const ranking = await findRanking(body.ranking_id);
  const updated = one(await supabaseRest(`agent_rankings?id=eq.${enc(ranking.id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      recommended_tier: 'Not a Fit',
      next_best_action: 'Marked as not a fit by admin review.',
      raw_sources: {
        ...(ranking.raw_sources || {}),
        not_fit_at: new Date().toISOString(),
        not_fit_reason: String(body.reason || '').trim() || null
      }
    })
  }));
  return { ranking: updated || ranking };
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
      return;
    }

    assertAdminConfig();
    const auth = adminAuthorized(req);
    if (!auth.ok) {
      sendJson(res, 401, { ok: false, error: auth.error });
      return;
    }

    if (req.method === 'GET') {
      const payload = await handleList(req);
      sendJson(res, 200, { ok: true, ...payload });
      return;
    }

    const body = parseBody(req);
    const action = String(body.action || '').trim();
    if (action === 'preview_upload') {
      const result = await handlePreview(body);
      sendJson(res, 200, { ok: true, action, ...result });
      return;
    }
    if (action === 'confirm_import') {
      const result = await handleConfirm(body, auth);
      sendJson(res, 200, { ok: true, action, ...result });
      return;
    }
    if (action === 'add_to_outreach') {
      const result = await handleAddToOutreach(body);
      sendJson(res, 200, { ok: true, action, ...result });
      return;
    }
    if (action === 'generate_pitch') {
      const result = await handleGeneratePitch(body);
      sendJson(res, 200, { ok: true, action, ...result });
      return;
    }
    if (action === 'mark_not_fit') {
      const result = await handleNotFit(body);
      sendJson(res, 200, { ok: true, action, ...result });
      return;
    }

    sendJson(res, 400, { ok: false, error: 'Unsupported agent ranking action.' });
  } catch (error) {
    sendJson(res, error.status || 500, {
      ok: false,
      error: error.message || 'Unable to process agent ranking request.',
      details: error.payload || null
    });
  }
};
