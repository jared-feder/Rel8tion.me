const fs = require('fs')
const { createClient } = require('@supabase/supabase-js')

const LOCAL_CONFIG = {
  supabaseUrl: '',
  serviceRoleKey: '',
  mode: 'reverse',
  dryRun: true,
  agentWebsiteId: '',
  agentName: '',
  brokerage: '',
  phone: '',
  email: '',
  targetTable: 'agent_website_listings',
  websiteTable: 'agent_websites',
  queueTable: 'agent_website_listing_sync_queue',
  listingAgentsTable: 'listing_agents',
  openHousesTable: 'open_houses',
  source: 'scraper',
  limit: 25,
  queueLimit: 25,
  minScore: 60,
  autoFeaturedScore: 65,
  defaultState: 'NY',
  defaultPropertyType: 'Residential',
  defaultListingStatus: 'active',
  hideStaleSourceNotFound: true,
  skipOneKey: false,
  onekeySearchRadius: 0.08,
  onekeyMaxOffsets: 5,
  onekeyBaseUrl: 'https://www.onekeymls.com/api/search',
  fetchTimeoutMs: 20000,
  outputFile: 'agent-website-listings-runner-report.json',
  verbose: false,
}

function toCamelFlag(key) {
  return key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
}

function parseArgs(argv = process.argv.slice(2)) {
  const out = {}
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue
    const [rawKey, ...rest] = arg.slice(2).split('=')
    const key = toCamelFlag(rawKey)
    out[key] = rest.length ? rest.join('=') : 'true'
  }
  return out
}

function envConfig(env = process.env) {
  return {
    supabaseUrl: env.REL8TION_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY,
    mode: env.LISTING_SYNC_MODE,
    dryRun: env.LISTING_SYNC_DRY_RUN,
    agentWebsiteId: env.AGENT_WEBSITE_ID,
    agentName: env.AGENT_NAME,
    brokerage: env.AGENT_BROKERAGE,
    phone: env.AGENT_PHONE,
    email: env.AGENT_EMAIL,
    minScore: env.LISTING_SYNC_MIN_SCORE,
    autoFeaturedScore: env.LISTING_SYNC_AUTO_FEATURED_SCORE,
    hideStaleSourceNotFound: env.LISTING_SYNC_HIDE_STALE_SOURCE_NOT_FOUND,
    skipOneKey: env.LISTING_SYNC_SKIP_ONEKEY,
    onekeySearchRadius: env.LISTING_SYNC_ONEKEY_SEARCH_RADIUS,
    onekeyMaxOffsets: env.LISTING_SYNC_ONEKEY_MAX_OFFSETS,
    onekeyBaseUrl: env.LISTING_SYNC_ONEKEY_BASE_URL,
    fetchTimeoutMs: env.LISTING_SYNC_FETCH_TIMEOUT_MS,
    limit: env.LISTING_SYNC_LIMIT,
    queueLimit: env.LISTING_SYNC_QUEUE_LIMIT,
    outputFile: env.LISTING_SYNC_OUTPUT_FILE,
    verbose: env.LISTING_SYNC_VERBOSE,
  }
}

function cleanConfig(input = {}) {
  const defined = (object = {}) => Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined && value !== ''),
  )
  const merged = { ...LOCAL_CONFIG, ...defined(envConfig()), ...defined(input) }
  const bool = (value) => {
    if (typeof value === 'boolean') return value
    if (value == null || value === '') return false
    return !/^(false|0|no)$/i.test(String(value))
  }
  const num = (value, fallback) => {
    const n = Number(value)
    return Number.isFinite(n) ? n : fallback
  }
  return {
    ...merged,
    dryRun: bool(merged.dryRun),
    verbose: bool(merged.verbose),
    limit: Math.max(1, Math.min(num(merged.limit, LOCAL_CONFIG.limit), 250)),
    queueLimit: Math.max(1, Math.min(num(merged.queueLimit, LOCAL_CONFIG.queueLimit), 100)),
    minScore: num(merged.minScore, LOCAL_CONFIG.minScore),
    autoFeaturedScore: num(merged.autoFeaturedScore, LOCAL_CONFIG.autoFeaturedScore),
    hideStaleSourceNotFound: bool(merged.hideStaleSourceNotFound),
    skipOneKey: bool(merged.skipOneKey),
    onekeySearchRadius: num(merged.onekeySearchRadius, LOCAL_CONFIG.onekeySearchRadius),
    onekeyMaxOffsets: Math.max(1, Math.min(num(merged.onekeyMaxOffsets, LOCAL_CONFIG.onekeyMaxOffsets), 10)),
    fetchTimeoutMs: Math.max(3000, Math.min(num(merged.fetchTimeoutMs, LOCAL_CONFIG.fetchTimeoutMs), 60000)),
  }
}

function normalizeText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ')
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase()
}

function normalizeBrokerageKey(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(limited liability company|llc|incorporated|inc|corp|corporation|co|company|ltd|realty|real estate|brokerage|brokers?)\b/g, ' ')
    .replace(/[^a-z0-9]/g, '')
}

function editDistance(a, b) {
  const left = String(a || '')
  const right = String(b || '')
  if (left === right) return 0
  if (!left.length) return right.length
  if (!right.length) return left.length
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  const current = Array(right.length + 1)
  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost,
      )
    }
    for (let j = 0; j <= right.length; j += 1) previous[j] = current[j]
  }
  return previous[right.length]
}

function isSimilarBrokerage(left, right) {
  const a = normalizeBrokerageKey(left)
  const b = normalizeBrokerageKey(right)
  if (!a || !b) return false
  if (a === b) return true
  if ((a.length >= 4 || b.length >= 4) && (a.includes(b) || b.includes(a))) return true
  const longest = Math.max(a.length, b.length)
  const allowedDistance = longest >= 10 ? 2 : 1
  return longest >= 4 && editDistance(a, b) <= allowedDistance
}

function strongerBrokerageName(current, candidate) {
  const currentText = normalizeText(current)
  const candidateText = normalizeText(candidate)
  if (!candidateText) return ''
  if (!currentText) return candidateText
  if (!isSimilarBrokerage(currentText, candidateText)) return ''
  if (normalizeKey(currentText) === normalizeKey(candidateText)) return ''
  const candidateHasLegalSuffix = /\b(llc|inc|corp|corporation|co|company|ltd|realty|real estate|brokerage|brokers?)\b/i.test(candidateText)
  const currentHasLegalSuffix = /\b(llc|inc|corp|corporation|co|company|ltd|realty|real estate|brokerage|brokers?)\b/i.test(currentText)
  if (candidateHasLegalSuffix && !currentHasLegalSuffix) return candidateText
  if (candidateText.length > currentText.length + 2) return candidateText
  return ''
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1)
  return digits
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase()
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(String(value).replace(/[^0-9.-]/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

function intOrNull(value) {
  const parsed = numberOrNull(value)
  return parsed === null ? null : Math.round(parsed)
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000).toISOString()
}

function arrayFrom(value) {
  if (Array.isArray(value)) return value.filter(Boolean)
  if (!value) return []
  return [value].filter(Boolean)
}

function imageArray(value) {
  return arrayFrom(value)
    .flatMap((item) => (typeof item === 'string' ? item.split(/\s*,\s*/) : []))
    .map((item) => normalizeText(item))
    .filter(Boolean)
    .filter((url, index, urls) => urls.indexOf(url) === index)
}

function cleanText(value) {
  return normalizeText(value).replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n')
}

function firstDeepValue(value, patterns, depth = 0) {
  if (depth > 8 || value == null || typeof value !== 'object') return null
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstDeepValue(item, patterns, depth + 1)
      if (found !== null && found !== undefined && found !== '') return found
    }
    return null
  }
  for (const [key, child] of Object.entries(value)) {
    if (patterns.some((pattern) => pattern.test(key)) && child !== null && child !== undefined && child !== '') return child
    const found = firstDeepValue(child, patterns, depth + 1)
    if (found !== null && found !== undefined && found !== '') return found
  }
  return null
}

function oneLineAddress(row) {
  return normalizeText(row.address || row.DisplayName || row.title || '')
}

function sameAddress(a, b) {
  const simplify = (value) => normalizeKey(value)
    .replace(/\b(?:ny|new york|street|st|avenue|ave|road|rd|drive|dr|lane|ln|court|ct|place|pl|unit|apt)\b/g, ' ')
    .replace(/[^a-z0-9]/g, '')
  const left = simplify(a)
  const right = simplify(b)
  return Boolean(left && right && (left === right || left.includes(right) || right.includes(left)))
}

function listingStatusFromHouse(house, config) {
  const freshnessStatus = normalizeKey(house?.freshness_status)
  if (config.hideStaleSourceNotFound && freshnessStatus === 'source_listing_not_found') return 'off_market'
  return config.defaultListingStatus
}

function listingStatusFromOneKey(record, house, config) {
  const status = normalizeKey(record?.Listing?.StandardStatus)
  if (status === 'active') return 'active'
  if (status === 'pending') return 'pending'
  return listingStatusFromHouse(house, config)
}

function confidenceBand(score) {
  if (score >= 90) return 'high'
  if (score >= 70) return 'medium'
  return 'low'
}

function makeClient(config) {
  if (!config.supabaseUrl || !config.serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.')
  }
  return createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function maybeSingleSite(supabase, config, agentWebsiteId) {
  const { data, error } = await supabase
    .from(config.websiteTable)
    .select('*')
    .eq('id', agentWebsiteId)
    .maybeSingle()
  if (error) throw error
  return data || null
}

async function buildProfile(supabase, config) {
  let site = null
  if (config.agentWebsiteId) site = await maybeSingleSite(supabase, config, config.agentWebsiteId)
  const agentName = normalizeText(config.agentName || site?.name)
  if (!config.agentWebsiteId && !site?.id) throw new Error('agentWebsiteId is required for reverse sync.')
  if (!agentName) throw new Error('agentName is required or must exist on agent_websites.name.')
  return {
    agent_website_id: config.agentWebsiteId || site.id,
    agent_name: agentName,
    brokerage: normalizeText(config.brokerage || site?.brokerage),
    phone: normalizeText(config.phone || site?.phone),
    phone_normalized: normalizePhone(config.phone || site?.phone),
    email: normalizeEmail(config.email || site?.email),
  }
}

async function fetchRows(query, label, warnings) {
  const { data, error } = await query
  if (error) {
    warnings.push({ label, error: error.message || error })
    return []
  }
  return data || []
}

async function collectCandidates(supabase, config, profile) {
  const warnings = []
  const listingSelect = '*'
  const openHouseSelect = '*'
  const raw = []

  if (profile.agent_name) {
    const rows = await fetchRows(
      supabase.from(config.listingAgentsTable).select(listingSelect).eq('name', profile.agent_name).limit(config.limit),
      'listing_agents_name',
      warnings,
    )
    raw.push(...rows.map((row) => ({ source_table: config.listingAgentsTable, query_reason: 'exact_agent_name', listing_agent: row })))
  }

  if (profile.phone_normalized) {
    const rows = await fetchRows(
      supabase.from(config.listingAgentsTable).select(listingSelect).eq('phone_normalized', profile.phone_normalized).limit(config.limit),
      'listing_agents_phone',
      warnings,
    )
    raw.push(...rows.map((row) => ({ source_table: config.listingAgentsTable, query_reason: 'phone_normalized', listing_agent: row })))
  }

  if (profile.email) {
    const rows = await fetchRows(
      supabase.from(config.listingAgentsTable).select(listingSelect).eq('email', profile.email).limit(config.limit),
      'listing_agents_email',
      warnings,
    )
    raw.push(...rows.map((row) => ({ source_table: config.listingAgentsTable, query_reason: 'email', listing_agent: row })))
  }

  if (profile.agent_name) {
    const rows = await fetchRows(
      supabase.from(config.openHousesTable).select(openHouseSelect).eq('agent', profile.agent_name).limit(config.limit),
      'open_houses_agent',
      warnings,
    )
    raw.push(...rows.map((row) => ({ source_table: config.openHousesTable, query_reason: 'exact_open_house_agent', open_house: row })))
  }

  if (profile.phone) {
    const rows = await fetchRows(
      supabase.from(config.openHousesTable).select(openHouseSelect).eq('agent_phone', profile.phone).limit(config.limit),
      'open_houses_agent_phone',
      warnings,
    )
    raw.push(...rows.map((row) => ({ source_table: config.openHousesTable, query_reason: 'open_house_agent_phone', open_house: row })))
  }

  const openHouseIds = [...new Set(raw.map((item) => item.listing_agent?.open_house_id).filter(Boolean))]
  const openHouseById = new Map()
  for (let i = 0; i < openHouseIds.length; i += 100) {
    const ids = openHouseIds.slice(i, i + 100)
    const rows = await fetchRows(
      supabase.from(config.openHousesTable).select(openHouseSelect).in('id', ids),
      'open_houses_hydrate',
      warnings,
    )
    rows.forEach((row) => openHouseById.set(String(row.id), row))
  }

  return {
    raw,
    warnings,
    prepared: raw.map((item) => ({
      ...item,
      open_house: item.open_house || openHouseById.get(String(item.listing_agent?.open_house_id || '')) || null,
    })),
  }
}

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json,text/plain,*/*' },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.json()
  } finally {
    clearTimeout(timeout)
  }
}

function oneKeyFacts(record) {
  return {
    annual_property_taxes: numberOrNull(firstDeepValue(record, [
      /taxannualamount/i,
      /annualtax/i,
      /propertytax/i,
      /^taxes$/i,
    ])),
    hoa_monthly: numberOrNull(record?.Computed?.HoaMonthlyFee || firstDeepValue(record, [/hoamonthly/i, /associationfeemonthly/i])),
    price_per_sqft: numberOrNull(record?.Computed?.PricePerSquareFoot),
    lot_size: numberOrNull(record?.Computed?.LotSizeSquareFeet || record?.LotSizeSquareFeet),
    year_built: intOrNull(record?.Structure?.YearBuilt || record?.YearBuilt),
    source_kind: 'local+onekey',
  }
}

function oneKeyFeatures(record) {
  const computed = record?.Computed || {}
  const characteristics = record?.CharacteristicsDerived || {}
  const structure = record?.StructureDerived || {}
  return [
    computed.HoaMonthlyFee ? `${moneyValue(computed.HoaMonthlyFee)}/mo HOA` : '',
    computed.PricePerSquareFoot ? `${moneyValue(computed.PricePerSquareFoot)}/sqft` : '',
    computed.LotSizeSquareFeet ? `${Math.round(Number(computed.LotSizeSquareFeet)).toLocaleString()} sqft lot` : '',
    characteristics.PoolYN ? 'Pool' : '',
    characteristics.WaterfrontYN ? 'Waterfront' : '',
    characteristics.ViewYN ? 'View' : '',
    characteristics.AtticYN ? 'Attic' : '',
    structure.BasementYN ? 'Basement' : '',
    structure.GarageYN ? 'Garage' : '',
    structure.CoolingYN ? 'Cooling' : '',
    structure.FireplaceYN ? 'Fireplace' : '',
    structure.NewConstructionYN ? 'New construction' : '',
    ...(Array.isArray(computed.PropertySearchType) ? computed.PropertySearchType : []),
  ].map((item) => normalizeText(item)).filter(Boolean).filter((item, index, list) => list.indexOf(item) === index)
}

function moneyValue(value) {
  const number = numberOrNull(value)
  if (number === null) return ''
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(number)
}

async function enrichPreparedWithOneKey(prepared, config) {
  if (config.skipOneKey) return prepared
  const enriched = []
  for (const item of prepared) {
    const house = item.open_house || {}
    const lat = numberOrNull(house.lat)
    const lng = numberOrNull(house.lng)
    if (lat === null || lng === null) {
      enriched.push(item)
      continue
    }
    try {
      const match = await findOneKeyActiveRecord(item, config, lat, lng)
      enriched.push(match ? { ...item, onekey_record: match.record, onekey_match_reason: match.reason } : item)
    } catch (error) {
      enriched.push({
        ...item,
        onekey_error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return enriched
}

async function findOneKeyActiveRecord(item, config, lat, lng) {
  const house = item.open_house || {}
  const agent = item.listing_agent || {}
  const mlsId = String(agent.unique_listing_id || agent.open_house_id || house.id || '').replace(/^open_house:/, '')
  const radius = Number(config.onekeySearchRadius || LOCAL_CONFIG.onekeySearchRadius)
  const topLeft = `[${(lng - radius).toFixed(6)},${(lat + radius).toFixed(6)}]`
  const bottomRight = `[${(lng + radius).toFixed(6)},${(lat - radius).toFixed(6)}]`
  const maxOffsets = Number(config.onekeyMaxOffsets || LOCAL_CONFIG.onekeyMaxOffsets)

  for (let index = 0; index < maxOffsets; index += 1) {
    const offset = index * 100
    const url = `${config.onekeyBaseUrl}?topLeft=${encodeURIComponent(topLeft)}&bottomRight=${encodeURIComponent(bottomRight)}&propertySaleType=Sale&StateOrProvince=NY&offset=${offset}`
    const data = await fetchJson(url, config.fetchTimeoutMs)
    const results = Array.isArray(data?.Results) ? data.Results : []
    if (!results.length) break

    const exactId = mlsId ? results.find((row) => String(row.UniqueListingId || '') === mlsId) : null
    const addressMatch = results.find((row) => sameAddress(row.DisplayName, oneLineAddress(house)))
    const record = exactId || addressMatch
    if (record) return { record, reason: exactId ? 'exact_id_match' : 'address_match' }

    const total = Number(data?.Total || 0)
    if (total && offset + results.length >= total) break
  }
  return null
}

function candidateId(item) {
  const agent = item.listing_agent || {}
  const house = item.open_house || {}
  return normalizeText(agent.unique_listing_id || agent.open_house_id || house.id || agent.id || house.link || house.address)
}

function scoreCandidate(item, profile) {
  const agent = item.listing_agent || {}
  const house = item.open_house || {}
  const candidateAgentName = normalizeText(agent.name || house.agent)
  const candidateBrokerage = normalizeText(agent.brokerage || house.brokerage)
  const candidatePhone = normalizePhone(agent.phone || house.agent_phone)
  const candidateEmail = normalizeEmail(agent.email || house.agent_email)
  const address = oneLineAddress(house)
  const image = house.image || agent.primary_photo_url || agent.directory_photo_url
  let score = 0
  const reasons = []

  if (profile.agent_name && normalizeKey(candidateAgentName) === normalizeKey(profile.agent_name)) {
    score += 40
    reasons.push('exact_agent_name')
  }
  if (profile.brokerage && candidateBrokerage && normalizeKey(candidateBrokerage) === normalizeKey(profile.brokerage)) {
    score += 25
    reasons.push('exact_brokerage')
  }
  if (
    profile.brokerage &&
    candidateBrokerage &&
    normalizeKey(candidateBrokerage) !== normalizeKey(profile.brokerage) &&
    isSimilarBrokerage(candidateBrokerage, profile.brokerage)
  ) {
    score += 25
    reasons.push('similar_brokerage')
  }
  if (profile.phone_normalized && candidatePhone && candidatePhone === profile.phone_normalized) {
    score += 35
    reasons.push('phone_match')
  }
  if (profile.email && candidateEmail && candidateEmail === profile.email) {
    score += 35
    reasons.push('email_match')
  }
  if (address) {
    score += 10
    reasons.push('has_address')
  }
  if (image) {
    score += 10
    reasons.push('has_image')
  }
  if (
    profile.brokerage &&
    candidateBrokerage &&
    normalizeKey(candidateBrokerage) !== normalizeKey(profile.brokerage) &&
    !isSimilarBrokerage(candidateBrokerage, profile.brokerage)
  ) {
    score -= 35
    reasons.push('brokerage_mismatch')
  }

  return { score, reasons }
}

function toListingPayload(item, profile, config, nowIso) {
  const agent = item.listing_agent || {}
  const house = item.open_house || {}
  const oneKey = item.onekey_record || null
  const oneKeyComputed = oneKey?.Computed || {}
  const oneKeyStructure = oneKey?.Structure || {}
  const oneKeyLocation = oneKey?.Location || {}
  const oneKeyListing = oneKey?.Listing || {}
  const oneKeyAgent = oneKeyListing?.ListAgent || oneKeyListing?.Agent || {}
  const oneKeyOffice = oneKeyListing?.AgentOffice?.ListOffice || oneKeyListing?.ListOffice || {}
  const oneKeyFactsData = oneKey ? oneKeyFacts(oneKey) : {}
  const id = candidateId(item)
  const { score, reasons } = scoreCandidate(item, profile)
  const oneKeyImages = oneKey ? imageArray(oneKey.Media?.map?.((media) => media.MediaURL) || oneKey.MediaURL || oneKey.ImagesHero) : []
  const image = oneKeyImages[0] || house.image || agent.primary_photo_url || agent.directory_photo_url || null
  const sourceListingId = String(id || '').trim()
  const address = oneKey?.DisplayName || oneLineAddress(house)
  const description = cleanText(firstDeepValue(oneKey, [/publicremarks/i, /remarks/i, /description/i, /marketing/i])) || house.description || null
  const annualPropertyTaxes = numberOrNull(oneKeyFactsData.annual_property_taxes || house.taxes)
  const lotSize = numberOrNull(oneKeyFactsData.lot_size)
  const yearBuilt = intOrNull(oneKeyFactsData.year_built)
  const sourceFacts = {
    annual_property_taxes: annualPropertyTaxes,
    hoa_monthly: numberOrNull(oneKeyFactsData.hoa_monthly),
    price_per_sqft: numberOrNull(oneKeyFactsData.price_per_sqft),
    lot_size: lotSize,
    year_built: yearBuilt,
    onekey_active_match_reason: item.onekey_match_reason || null,
    onekey_active_status: oneKeyListing?.StandardStatus || null,
    onekey_active_checked_at: oneKey ? nowIso : null,
    onekey_error: item.onekey_error || null,
    source_price: house.source_price || null,
    source_price_verified_at: house.source_price_verified_at || null,
    price_last_changed_at: house.price_last_changed_at || null,
    last_verified_at: house.last_verified_at || null,
    last_verified_source: house.last_verified_source || null,
    freshness_status: house.freshness_status || null,
    freshness_notes: house.freshness_notes || null,
    brokerage_phone: house.brokerage_phone || null,
    listing_agent_member_key: agent.member_key || null,
    listing_agent_member_type: agent.display_member_type || null,
    listing_agent_active_listing_count: agent.active_listing_count || null,
    listing_agent_active_open_house_count: agent.active_open_house_count || null,
  }

  if (!sourceListingId || !address) return { eligible: false, reason: !sourceListingId ? 'missing_source_listing_id' : 'missing_address', score }

  const metadata = {
    scraped_at: agent.scraped_at || house.updated_at || house.created_at || null,
    matched_at: nowIso,
    confidence_score: score,
    confidence_band: confidenceBand(score),
    match_reason: reasons,
    query_reason: item.query_reason,
    source_table: item.source_table,
    source_row_id: agent.id || house.id || null,
    open_house_id: house.id || agent.open_house_id || null,
    listing_agent_id: agent.id || null,
    source_facts: sourceFacts,
    profile_snapshot: profile,
    runner: 'rel8tion_agent_website_listings_runner.cjs',
  }

  return {
    eligible: score >= config.minScore,
    reason: score >= config.minScore ? 'eligible' : 'low_confidence',
    score,
    payload: {
      agent_website_id: profile.agent_website_id,
      source: config.source,
      source_listing_id: sourceListingId,
      mls_id: oneKey?.UniqueListingId || agent.unique_listing_id || house.id || null,
      title: address,
      address,
      city: oneKeyLocation.City || house.city || null,
      state: oneKeyLocation.StateOrProvince || house.state || config.defaultState,
      zip: oneKeyLocation.PostalCode || house.zip || null,
      price: numberOrNull(oneKeyListing?.Price?.ListPrice) ?? house.price ?? null,
      beds: numberOrNull(oneKeyStructure.BedroomsTotal || oneKeyComputed.BedroomsTotalInteger) ?? house.beds ?? null,
      baths: numberOrNull(oneKeyStructure.BathroomsTotalInteger || oneKeyComputed.BathroomsTotalInteger) ?? house.baths ?? null,
      sqft: intOrNull(oneKeyStructure.LivingArea || oneKeyComputed.LivingAreaSquareFeet) ?? house.sqft ?? null,
      lot_size: lotSize,
      year_built: yearBuilt,
      annual_property_taxes: annualPropertyTaxes,
      property_type: oneKey?.PropertyType || config.defaultPropertyType,
      listing_status: listingStatusFromOneKey(oneKey, house, config),
      description,
      features: oneKeyFeatures(oneKey).slice(0, 32),
      images: oneKeyImages.length ? oneKeyImages : arrayFrom(image),
      primary_image: image,
      listing_url: oneKey?.CanonicalURL || oneKey?.ListingURL || house.link || agent.profile_url || null,
      brokerage: oneKeyOffice.ListOfficeName || agent.brokerage || house.brokerage || profile.brokerage || null,
      agent_name: oneKeyAgent.FullName || oneKeyAgent.MemberFullName || agent.name || house.agent || profile.agent_name,
      agent_phone: oneKeyAgent.Phone || oneKeyAgent.MobilePhone || agent.phone || house.agent_phone || profile.phone || null,
      agent_email: oneKeyAgent.Email || agent.email || house.agent_email || profile.email || null,
      open_house_start: oneKeyComputed.OpenHousesEarliestStartTime || house.open_start || null,
      open_house_end: oneKeyComputed.OpenHousesEarliestEndTime || house.open_end || null,
      lat: numberOrNull(oneKey?.LocationPoint?.lat) ?? house.lat ?? null,
      lng: numberOrNull(oneKey?.LocationPoint?.lon) ?? house.lng ?? null,
      is_featured: score >= config.autoFeaturedScore,
      metadata,
      updated_at: nowIso,
    },
  }
}

function dedupeCandidates(prepared, profile, config) {
  const byId = new Map()
  const nowIso = new Date().toISOString()
  for (const item of prepared) {
    const transformed = toListingPayload(item, profile, config, nowIso)
    const key = transformed.payload?.source_listing_id || candidateId(item) || `${item.source_table}:${item.listing_agent?.id || item.open_house?.id}`
    const current = byId.get(key)
    if (!current || transformed.score > current.score) byId.set(key, transformed)
  }
  return [...byId.values()]
}

function mergePayloadWithExisting(payload, existing) {
  if (!existing) return payload
  const mergedMetadata = {
    ...(existing.metadata || {}),
    ...(payload.metadata || {}),
    source_facts: {
      ...(existing.metadata?.source_facts || {}),
      ...(payload.metadata?.source_facts || {}),
    },
  }
  return {
    ...payload,
    annual_property_taxes: payload.annual_property_taxes ?? existing.annual_property_taxes ?? null,
    description: payload.description || existing.description || null,
    lot_size: payload.lot_size ?? existing.lot_size ?? null,
    year_built: payload.year_built ?? existing.year_built ?? null,
    listing_url: payload.listing_url || existing.listing_url || null,
    disclaimer: payload.disclaimer || existing.disclaimer || null,
    features: Array.isArray(payload.features) && payload.features.length ? payload.features : (existing.features || []),
    images: Array.isArray(payload.images) && payload.images.length ? payload.images : (existing.images || []),
    primary_image: payload.primary_image || existing.primary_image || null,
    metadata: mergedMetadata,
  }
}

async function mergeExistingListingPayloads(supabase, config, payloads) {
  const bySite = new Map()
  for (const payload of payloads) {
    const list = bySite.get(payload.agent_website_id) || []
    list.push(payload)
    bySite.set(payload.agent_website_id, list)
  }

  const existingByKey = new Map()
  for (const [siteId, sitePayloads] of bySite.entries()) {
    const ids = [...new Set(sitePayloads.map((payload) => payload.source_listing_id).filter(Boolean))]
    if (!ids.length) continue
    const { data, error } = await supabase
      .from(config.targetTable)
      .select('*')
      .eq('agent_website_id', siteId)
      .eq('source', config.source)
      .in('source_listing_id', ids)
    if (error) throw error
    for (const row of data || []) {
      existingByKey.set(`${row.agent_website_id}:${row.source}:${row.source_listing_id}`, row)
    }
  }

  return payloads.map((payload) => {
    const key = `${payload.agent_website_id}:${payload.source}:${payload.source_listing_id}`
    return mergePayloadWithExisting(payload, existingByKey.get(key))
  })
}

async function writeEligible(supabase, config, eligible) {
  if (config.dryRun || !eligible.length) return { written: 0, errors: [] }
  const payload = await mergeExistingListingPayloads(supabase, config, eligible.map((item) => item.payload))
  const { data, error } = await supabase
    .from(config.targetTable)
    .upsert(payload, { onConflict: 'agent_website_id,source,source_listing_id' })
    .select('id,source_listing_id')
  if (error) return { written: 0, errors: [error.message || error] }
  return { written: data?.length || payload.length, errors: [] }
}

async function backfillWebsiteBrokerage(supabase, config, profile, eligible) {
  const updates = []
  for (const item of eligible) {
    const candidate = item.payload?.brokerage
    const stronger = strongerBrokerageName(profile.brokerage, candidate)
    if (stronger) updates.push({ brokerage: stronger, score: item.score })
  }
  updates.sort((a, b) => b.score - a.score || b.brokerage.length - a.brokerage.length)
  const selected = updates[0]?.brokerage || ''
  if (!selected) return { updated: false, brokerage: profile.brokerage || null }
  if (config.dryRun) return { updated: true, dryRun: true, brokerage: selected }

  const nowIso = new Date().toISOString()
  const { error } = await supabase
    .from(config.websiteTable)
    .update({ brokerage: selected, updated_at: nowIso })
    .eq('id', profile.agent_website_id)
  if (error) return { updated: false, brokerage: profile.brokerage || null, error: error.message || error }
  return { updated: true, brokerage: selected }
}

async function runSmoke(supabase, config) {
  const siteId = config.agentWebsiteId
  if (!siteId) throw new Error('Smoke mode requires --agent-website-id.')
  const nowIso = new Date().toISOString()
  const payload = {
    agent_website_id: siteId,
    source: config.source,
    source_listing_id: `smoke-${siteId}`,
    mls_id: `smoke-${siteId}`,
    title: 'Smoke Test Listing',
    address: '1 Rel8tion Test Way',
    state: config.defaultState,
    property_type: config.defaultPropertyType,
    listing_status: config.defaultListingStatus,
    features: [],
    images: [],
    is_featured: true,
    metadata: { runner: 'rel8tion_agent_website_listings_runner.cjs', smoke: true, matched_at: nowIso },
    updated_at: nowIso,
  }
  if (config.dryRun) return { mode: 'smoke', dryRun: true, written: 0, payload }
  const { data, error } = await supabase
    .from(config.targetTable)
    .upsert(payload, { onConflict: 'agent_website_id,source,source_listing_id' })
    .select('id,source_listing_id')
  if (error) throw error
  return { mode: 'smoke', dryRun: false, written: data?.length || 1, payload }
}

async function runReverse(supabase, config) {
  const profile = await buildProfile(supabase, config)
  const collected = await collectCandidates(supabase, config, profile)
  const enrichedPrepared = await enrichPreparedWithOneKey(collected.prepared, config)
  const candidates = dedupeCandidates(enrichedPrepared, profile, config)
  const eligible = candidates.filter((item) => item.eligible)
  const skippedLowConfidence = candidates.filter((item) => item.reason === 'low_confidence')
  const failedPrep = candidates.filter((item) => !item.eligible && item.reason !== 'low_confidence')
  const writeResult = await writeEligible(supabase, config, eligible)
  const brokerageBackfill = await backfillWebsiteBrokerage(supabase, config, profile, eligible)

  return {
    mode: 'reverse',
    dryRun: config.dryRun,
    profile,
    rawCandidates: collected.raw.length,
    preparedCandidates: enrichedPrepared.length,
    enrichedCandidates: enrichedPrepared.filter((item) => item.onekey_record).length,
    eligibleWrites: eligible.length,
    actualWrites: writeResult.written,
    skippedLowConfidence: skippedLowConfidence.length,
    failedPrepared: failedPrep.length,
    warnings: collected.warnings,
    writeErrors: writeResult.errors,
    brokerageBackfill,
    candidates: config.verbose ? candidates : candidates.map((item) => ({
      source_listing_id: item.payload?.source_listing_id || null,
      score: item.score,
      reason: item.reason,
      match_reason: item.payload?.metadata?.match_reason || [],
      address: item.payload?.address || null,
    })),
  }
}

async function enqueueDueWebsites(supabase, config) {
  const { data: sites, error } = await supabase
    .from(config.websiteTable)
    .select('*')
    .eq('listing_sync_enabled', true)
    .eq('status', 'published')
    .or(`listing_sync_next_run_at.is.null,listing_sync_next_run_at.lte.${new Date().toISOString()}`)
    .limit(50)
  if (error) throw error

  const now = new Date().toISOString()
  const rows = (sites || []).map((site) => ({
    agent_website_id: site.id,
    agent_name: site.name,
    brokerage: site.brokerage,
    phone: site.phone,
    email: site.email,
    status: 'pending',
    priority: 5,
    run_after: now,
  }))
  if (!rows.length || config.dryRun) return { enqueued: config.dryRun ? rows.length : 0, due: rows.length }
  let enqueued = 0
  for (const row of rows) {
    const { error: insertError } = await supabase.from(config.queueTable).insert(row)
    if (insertError) {
      if (/duplicate key|unique/i.test(insertError.message || '')) continue
      throw insertError
    }
    enqueued += 1
  }
  return { enqueued, due: rows.length }
}

async function pullQueue(supabase, config) {
  const { data, error } = await supabase
    .from(config.queueTable)
    .select('*')
    .eq('status', 'pending')
    .lte('run_after', new Date().toISOString())
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(config.queueLimit)
  if (error) throw error
  return data || []
}

async function updateQueue(supabase, config, id, patch) {
  if (config.dryRun) return
  const { error } = await supabase
    .from(config.queueTable)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

async function runCron(supabase, config) {
  const enqueue = await enqueueDueWebsites(supabase, config)
  const queue = await pullQueue(supabase, config)
  const now = new Date()
  const summary = {
    mode: 'cron',
    dryRun: config.dryRun,
    enqueued: enqueue.enqueued,
    due: enqueue.due,
    processed: 0,
    written: 0,
    failed: 0,
    failedQueueRows: [],
    rows: [],
  }

  for (const row of queue) {
    try {
      await updateQueue(supabase, config, row.id, { status: 'running' })
      const result = await runReverse(supabase, {
        ...config,
        agentWebsiteId: row.agent_website_id,
        agentName: row.agent_name,
        brokerage: row.brokerage,
        phone: row.phone,
        email: row.email,
      })
      summary.processed += 1
      summary.written += result.actualWrites || 0
      summary.rows.push({ queueId: row.id, agentWebsiteId: row.agent_website_id, result })

      if (!config.dryRun) {
        const nowIso = new Date().toISOString()
        await updateQueue(supabase, config, row.id, { status: 'completed', last_error: null })
        await supabase.from(config.websiteTable).update({
          listing_sync_status: 'synced',
          listing_sync_last_run_at: nowIso,
          listing_sync_next_run_at: addMinutes(new Date(nowIso), 30),
          listing_sync_last_error: null,
          updated_at: nowIso,
        }).eq('id', row.agent_website_id)
      }
    } catch (error) {
      const attempts = Number(row.attempts || 0) + 1
      const failed = attempts >= 3
      const message = error.message || String(error)
      summary.failed += 1
      summary.failedQueueRows.push({ queueId: row.id, agentWebsiteId: row.agent_website_id, attempts, error: message })
      if (!config.dryRun) {
        await updateQueue(supabase, config, row.id, {
          status: failed ? 'failed' : 'pending',
          attempts,
          last_error: message,
          run_after: addMinutes(now, 10),
        })
        await supabase.from(config.websiteTable).update({
          listing_sync_status: failed ? 'failed' : 'pending',
          listing_sync_last_error: message,
          updated_at: new Date().toISOString(),
        }).eq('id', row.agent_website_id)
      }
    }
  }
  return summary
}

function printSummary(result) {
  console.log(JSON.stringify({
    mode: result.mode,
    dryRun: result.dryRun,
    rawCandidates: result.rawCandidates,
    preparedCandidates: result.preparedCandidates,
    eligibleWrites: result.eligibleWrites,
    actualWrites: result.actualWrites,
    skippedLowConfidence: result.skippedLowConfidence,
    failedQueueRows: result.failedQueueRows?.length || 0,
    processed: result.processed,
    written: result.written,
    failed: result.failed,
  }, null, 2))
}

async function run(overrides = {}) {
  const config = cleanConfig({ ...parseArgs(), ...overrides })
  const supabase = makeClient(config)
  let result
  if (config.mode === 'smoke') result = await runSmoke(supabase, config)
  else if (config.mode === 'cron') result = await runCron(supabase, config)
  else if (config.mode === 'reverse') result = await runReverse(supabase, config)
  else throw new Error(`Unsupported mode: ${config.mode}`)

  if (config.outputFile) {
    fs.writeFileSync(config.outputFile, JSON.stringify(result, null, 2))
  }
  return result
}

if (require.main === module) {
  run()
    .then((result) => {
      printSummary(result)
      console.log(`Report written to ${cleanConfig(parseArgs()).outputFile}`)
    })
    .catch((error) => {
      console.error('[agent-website-listings-runner] failed:', error)
      process.exit(1)
    })
}

module.exports = { LOCAL_CONFIG, run, runReverse, runCron, runSmoke }
