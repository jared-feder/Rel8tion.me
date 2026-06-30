function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeKey(value) {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ');
}

function normalizeZip(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 5 ? digits.slice(0, 5) : digits;
}

const COUNTY_ALIASES = new Map([
  ['nassau', 'Nassau'],
  ['nassau county', 'Nassau'],
  ['suffolk', 'Suffolk'],
  ['suffolk county', 'Suffolk'],
  ['queens', 'Queens'],
  ['queens county', 'Queens'],
  ['kings', 'Kings / Brooklyn'],
  ['kings county', 'Kings / Brooklyn'],
  ['brooklyn', 'Kings / Brooklyn'],
  ['new york', 'New York / Manhattan'],
  ['new york county', 'New York / Manhattan'],
  ['manhattan', 'New York / Manhattan'],
  ['bronx', 'Bronx'],
  ['bronx county', 'Bronx'],
  ['richmond', 'Richmond / Staten Island'],
  ['richmond county', 'Richmond / Staten Island'],
  ['staten island', 'Richmond / Staten Island'],
  ['westchester', 'Westchester'],
  ['westchester county', 'Westchester'],
  ['rockland', 'Rockland'],
  ['rockland county', 'Rockland'],
  ['putnam', 'Putnam'],
  ['putnam county', 'Putnam'],
  ['orange', 'Orange'],
  ['orange county', 'Orange'],
  ['dutchess', 'Dutchess'],
  ['dutchess county', 'Dutchess']
]);

const CITY_COUNTY = new Map(Object.entries({
  // Nassau
  'albertson': 'Nassau',
  'baldwin': 'Nassau',
  'bellmore': 'Nassau',
  'bethpage': 'Nassau',
  'carle place': 'Nassau',
  'cedarhurst': 'Nassau',
  'east meadow': 'Nassau',
  'east rockaway': 'Nassau',
  'elmont': 'Nassau',
  'farmingdale': 'Nassau',
  'floral park': 'Nassau',
  'freeport': 'Nassau',
  'garden city': 'Nassau',
  'glen cove': 'Nassau',
  'great neck': 'Nassau',
  'hempstead': 'Nassau',
  'hicksville': 'Nassau',
  'jericho': 'Nassau',
  'levittown': 'Nassau',
  'long beach': 'Nassau',
  'lynbrook': 'Nassau',
  'malverne': 'Nassau',
  'manhasset': 'Nassau',
  'massapequa': 'Nassau',
  'merrick': 'Nassau',
  'mineola': 'Nassau',
  'new hyde park': 'Nassau',
  'oceanside': 'Nassau',
  'old westbury': 'Nassau',
  'plainview': 'Nassau',
  'port washington': 'Nassau',
  'rockville centre': 'Nassau',
  'roslyn': 'Nassau',
  'seaford': 'Nassau',
  'syosset': 'Nassau',
  'valley stream': 'Nassau',
  'wantagh': 'Nassau',
  'westbury': 'Nassau',
  'woodmere': 'Nassau',
  // Suffolk
  'amityville': 'Suffolk',
  'babylon': 'Suffolk',
  'bay shore': 'Suffolk',
  'bayport': 'Suffolk',
  'bohemia': 'Suffolk',
  'brentwood': 'Suffolk',
  'central islip': 'Suffolk',
  'commack': 'Suffolk',
  'coram': 'Suffolk',
  'deer park': 'Suffolk',
  'dix hills': 'Suffolk',
  'east hampton': 'Suffolk',
  'east islip': 'Suffolk',
  'farmingville': 'Suffolk',
  'hauppauge': 'Suffolk',
  'holbrook': 'Suffolk',
  'huntington': 'Suffolk',
  'islip': 'Suffolk',
  'kings park': 'Suffolk',
  'lindenhurst': 'Suffolk',
  'medford': 'Suffolk',
  'melville': 'Suffolk',
  'montauk': 'Suffolk',
  'nesconset': 'Suffolk',
  'northport': 'Suffolk',
  'patchogue': 'Suffolk',
  'port jefferson': 'Suffolk',
  'riverhead': 'Suffolk',
  'ronkonkoma': 'Suffolk',
  'sag harbor': 'Suffolk',
  'sayville': 'Suffolk',
  'selden': 'Suffolk',
  'smithtown': 'Suffolk',
  'southampton': 'Suffolk',
  'stony brook': 'Suffolk',
  'westhampton': 'Suffolk',
  'wyandanch': 'Suffolk',
  // NYC
  'queens': 'Queens',
  'astoria': 'Queens',
  'bayside': 'Queens',
  'flushing': 'Queens',
  'forest hills': 'Queens',
  'jamaica': 'Queens',
  'long island city': 'Queens',
  'rego park': 'Queens',
  'richmond hill': 'Queens',
  'rockaway': 'Queens',
  'brooklyn': 'Kings / Brooklyn',
  'williamsburg': 'Kings / Brooklyn',
  'park slope': 'Kings / Brooklyn',
  'manhattan': 'New York / Manhattan',
  'new york': 'New York / Manhattan',
  'bronx': 'Bronx',
  'staten island': 'Richmond / Staten Island',
  // Hudson Valley
  'white plains': 'Westchester',
  'yonkers': 'Westchester',
  'new rochelle': 'Westchester',
  'scarsdale': 'Westchester',
  'rye': 'Westchester',
  'tarrytown': 'Westchester',
  'ossining': 'Westchester',
  'nyack': 'Rockland',
  'nanuet': 'Rockland',
  'suffern': 'Rockland',
  'new city': 'Rockland',
  'carmel': 'Putnam',
  'cold spring': 'Putnam',
  'brewster': 'Putnam',
  'middletown': 'Orange',
  'newburgh': 'Orange',
  'goshen': 'Orange',
  'warwick': 'Orange',
  'poughkeepsie': 'Dutchess',
  'fishkill': 'Dutchess',
  'beacon': 'Dutchess',
  'rhinebeck': 'Dutchess'
}));

function normalizeCounty(value) {
  const key = normalizeKey(value);
  if (!key) return '';
  return COUNTY_ALIASES.get(key) || cleanText(value).replace(/\s+county$/i, '');
}

function countyFromZip(zip) {
  const code = normalizeZip(zip);
  if (!code) return '';
  const n = Number(code);
  if (!Number.isFinite(n)) return '';
  if (n >= 10000 && n <= 10299) return 'New York / Manhattan';
  if (n >= 10300 && n <= 10399) return 'Richmond / Staten Island';
  if (n >= 10400 && n <= 10499) return 'Bronx';
  if (n >= 10600 && n <= 10899) return 'Westchester';
  if (n >= 11100 && n <= 11199) return 'Queens';
  if (n >= 11200 && n <= 11299) return 'Kings / Brooklyn';
  if (n >= 11300 && n <= 11699) return 'Queens';
  if (n >= 11900 && n <= 11999) return 'Suffolk';
  if (n >= 12600 && n <= 12699) return 'Dutchess';
  if (n >= 11500 && n <= 11599) return 'Nassau';
  if (n >= 11800 && n <= 11899) return 'Nassau';
  if (n >= 11700 && n <= 11799) {
    const nassau117 = new Set(['11710', '11714', '11732', '11735', '11753', '11756', '11758', '11762', '11765', '11771', '11773', '11783', '11791', '11793', '11797']);
    return nassau117.has(code) ? 'Nassau' : 'Suffolk';
  }
  if (n >= 12500 && n <= 12599) return 'Dutchess';
  if (n >= 10900 && n <= 10999) {
    const rockland109 = new Set(['10901', '10913', '10920', '10923', '10927', '10952', '10954', '10956', '10960', '10962', '10964', '10965', '10968', '10970', '10974', '10976', '10977', '10980', '10983', '10984', '10989', '10993', '10994']);
    return rockland109.has(code) ? 'Rockland' : 'Orange';
  }
  if (n >= 10500 && n <= 10599) {
    const putnam105 = new Set(['10509', '10512', '10516', '10524', '10537', '10541', '10542', '10579', '10588']);
    return putnam105.has(code) ? 'Putnam' : 'Westchester';
  }
  return '';
}

function countyFromCity(value) {
  return CITY_COUNTY.get(normalizeKey(value)) || '';
}

function countyFromFreeText(...values) {
  const text = normalizeKey(values.filter(Boolean).join(' '));
  if (!text) return '';
  for (const [key, county] of COUNTY_ALIASES.entries()) {
    if (text.includes(key)) return county;
  }
  for (const [city, county] of CITY_COUNTY.entries()) {
    if (text.includes(city)) return county;
  }
  return '';
}

function locationResult(row, county, confidence, source, extra = {}) {
  const primaryCounty = normalizeCounty(county);
  return {
    county: primaryCounty || '',
    primary_county: primaryCounty || '',
    inferred_county: source === 'imported_county' ? '' : primaryCounty || '',
    market_area: cleanText(row.market_area || row.area || row.region || row.territory || row.board_area || row.mls_area || extra.market_area || primaryCounty || ''),
    city: cleanText(row.city || row.town || row.municipality || extra.city || ''),
    state: cleanText(row.state || extra.state || 'NY') || 'NY',
    zip: normalizeZip(row.zip || row.zipcode || row.postal_code || extra.zip || ''),
    location_confidence: confidence,
    location_source: source
  };
}

function inferCountyFromRow(row = {}, options = {}) {
  const applyDefault = options.applyDefault !== false;
  const tryInference = options.tryInference !== false;
  const base = {
    ...row,
    state: row.state || options.defaultState || 'NY'
  };
  const importedCounty = normalizeCounty(base.county || base.agent_county || base.market_county || base.primary_county);
  if (importedCounty) return locationResult(base, importedCounty, 100, 'imported_county');

  if (tryInference) {
    const zipCounty = countyFromZip(base.zip || base.zipcode || base.postal_code);
    if (zipCounty) return locationResult(base, zipCounty, 85, 'zip_city_inferred');

    const cityCounty = countyFromCity(base.city || base.town || base.municipality);
    if (cityCounty) return locationResult(base, cityCounty, 75, 'zip_city_inferred');

    const textCounty = countyFromFreeText(base.market_area, base.area, base.region, base.territory, base.board_area, base.mls_area, base.address);
    if (textCounty) return locationResult(base, textCounty, 75, 'zip_city_inferred');
  }

  const defaultCounty = normalizeCounty(options.defaultCounty || options.default_county);
  if (applyDefault && defaultCounty) {
    return locationResult({
      ...base,
      market_area: base.market_area || options.defaultMarketArea || options.default_market_area || defaultCounty
    }, defaultCounty, 70, 'upload_default');
  }

  return locationResult({
    ...base,
    market_area: base.market_area || options.defaultMarketArea || options.default_market_area || ''
  }, '', 0, 'missing');
}

function sourcePriority(source) {
  return {
    manual_admin: 700,
    imported_county: 600,
    zip_city_inferred: 500,
    imported_city_zip_inferred: 500,
    open_house_match: 400,
    upload_default: 300,
    missing: 0
  }[source] || 0;
}

function isBetterLocation(current = {}, candidate = {}) {
  if (!candidate.primary_county && !candidate.county) return false;
  if (!current.primary_county && !current.county) return true;
  const currentPriority = sourcePriority(current.location_source);
  const candidatePriority = sourcePriority(candidate.location_source);
  if (candidatePriority !== currentPriority) return candidatePriority > currentPriority;
  return Number(candidate.location_confidence || 0) > Number(current.location_confidence || 0);
}

function mergeBestLocation(current = {}, candidate = {}) {
  return isBetterLocation(current, candidate) ? { ...current, ...candidate } : current;
}

module.exports = {
  countyFromCity,
  countyFromFreeText,
  countyFromZip,
  inferCountyFromRow,
  isBetterLocation,
  mergeBestLocation,
  normalizeCounty,
  normalizeZip
};
