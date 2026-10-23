const fs = require('fs');
const path = require('path');

function phone(value) {
  const digits = String(value || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  return /^\d{10}$/.test(digits) ? digits : '';
}
function nameParts(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\b(mba|mrp|cbr|sfr|abr|gri|crs|sres|realtor|broker|associate|jr|sr|cips|srs|psa)\b/g, '')
    .replace(/[^a-z]+/g, ' ').trim().split(/\s+/).filter(Boolean);
}
function validName(value) {
  const parts = nameParts(value);
  return parts.length >= 2 && !/\b(agent|unknown|listing|realty|real estate|properties|brokerage|group|llc|inc|source|phone|email)\b/i.test(value);
}
function samePerson(left, right) {
  if (!validName(left) || !validName(right)) return false;
  const a = nameParts(left), b = nameParts(right);
  return a[0] === b[0] && a[a.length - 1] === b[b.length - 1];
}
const blank = value => value == null || String(value).trim() === '';
const filter = (field, value) => field + (value == null ? '=is.null' : '=eq.' + encodeURIComponent(String(value)));
const present = value => !blank(value);

function parseListingContacts(text) {
  const block = String(text || '').match(/Listing by:(.*?)(Source:|Home Details|Property Information|$)/is)?.[1];
  if (!block) return null;
  const lines = block.split('\n').map(line => line.trim()).filter(Boolean);
  const companyLine = lines.find(line => /\b(realty|real estate|properties|brokerage|llc|inc|homes|elliman|corcoran|compass|re\/?max|coldwell banker|exp|douglas)\b/i.test(line));
  const brokerage = companyLine ? companyLine.replace(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, '').replace(/[,\s]+$/, '').trim() : null;
  const agents = [];
  const seen = new Set();
  let pendingName = '';
  for (const line of lines) {
    if (line === companyLine) { pendingName = ''; continue; }
    const number = line.match(/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/)?.[0];
    const email = line.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
    const cleaned = line.replace(number || /$^/, '').replace(email || /$^/, '').replace(/^[,\s:]+|[,\s:]+$/g, '').trim();
    if (!number) {
      if (email && agents.length) agents[agents.length - 1].email ||= email;
      else if (validName(cleaned)) pendingName = cleaned;
      continue;
    }
    const name = validName(cleaned) ? cleaned : pendingName;
    pendingName = '';
    const normalized = phone(number);
    if (!validName(name) || !normalized) continue;
    const identity = nameParts(name).join(' ') + '|' + normalized;
    if (seen.has(identity)) continue;
    seen.add(identity);
    agents.push({ name, phone:number, phone_normalized:normalized, ...(email ? {email} : {}) });
  }
  return { brokerage, agents, rawBlock:block };
}

function createStore({ get, post, patch, journal, log = console.log }) {
  if (!get || !post || !patch || !journal) throw new Error('Safe store requires API helpers and a write-ahead journal');
  async function fill(table, current, values, identityGuard = '') {
    for (const [field, value] of Object.entries(values)) {
      if (!blank(current[field]) || blank(value)) continue;
      const rowFilter = filter('id', current.id);
      journal({type:'before-fill', table, id:current.id, field, before:current[field] ?? null, proposed:value});
      const guard = typeof identityGuard === 'function' ? identityGuard(current) : identityGuard;
      const changed = await patch('/rest/v1/' + table + '?' + rowFilter + '&' + filter(field, current[field]) + guard, {[field]:value});
      if (changed?.length) current = changed[0];
      else log('Concurrent change preserved; skipped field:', field);
    }
    return current;
  }
  async function saveListingAgents(openHouseId, parsed) {
    const saved = [];
    for (const agent of parsed?.agents || []) {
      const normalized = phone(agent.phone_normalized || agent.phone);
      if (!normalized || !validName(agent.name)) { log('Rejected incomplete agent identity'); continue; }
      const query = '/rest/v1/listing_agents?open_house_id=eq.' + encodeURIComponent(openHouseId) + '&phone_normalized=eq.' + encodeURIComponent(normalized) + '&select=*';
      let rows = await get(query);
      if (rows.length > 1) throw new Error('Multiple existing agent rows for this event and phone; manual review required');
      const proposal = {open_house_id:openHouseId, name:agent.name, phone:agent.phone, phone_normalized:normalized, source:'trulia', scraped_at:new Date().toISOString()};
      if (present(parsed.brokerage)) proposal.brokerage = parsed.brokerage;
      if (present(agent.email)) proposal.email = agent.email;
      if (!rows.length) {
        journal({type:'before-insert', table:'listing_agents', proposed:proposal});
        // The injected POST helper must use ignore-duplicates, never merge-duplicates.
        await post('/rest/v1/listing_agents?on_conflict=open_house_id,phone_normalized', [proposal]);
        rows = await get(query);
      }
      if (rows.length !== 1) throw new Error('Agent insert could not be verified');
      let row = rows[0];
      if (!blank(row.name) && !samePerson(row.name, agent.name)) {
        journal({type:'identity-conflict', table:'listing_agents', id:row.id, existingName:row.name, proposedName:agent.name});
        log('Preserved conflicting person at shared phone; review required');
        continue;
      }
      row = await fill('listing_agents', row, {name:agent.name, phone:agent.phone, brokerage:parsed.brokerage, email:agent.email}, current => '&' + filter('name', current.name));
      const verified = (await get(query))[0];
      if (!verified || !samePerson(verified.name, agent.name) || phone(verified.phone_normalized || verified.phone) !== normalized) throw new Error('Saved agent identity verification failed');
      saved.push(verified);
    }
    return saved;
  }
  async function patchOpenHouseSuccess(openHouseId, primaryAgent, parsed = {}) {
    if (!primaryAgent || !validName(primaryAgent.name) || !phone(primaryAgent.phone_normalized || primaryAgent.phone)) return null;
    const query = '/rest/v1/open_houses?id=eq.' + encodeURIComponent(openHouseId) + '&select=*';
    let row = (await get(query))[0];
    if (!row) throw new Error('Open-house row missing');
    if ((present(row.agent) && !samePerson(row.agent, primaryAgent.name)) || (present(row.agent_phone) && phone(row.agent_phone) !== phone(primaryAgent.phone_normalized || primaryAgent.phone))) {
      journal({type:'identity-conflict', table:'open_houses', id:row.id});
      log('Existing open-house agent preserved; primary attribution conflict requires review');
      return null;
    }
    row = await fill('open_houses', row, {agent:primaryAgent.name, agent_phone:primaryAgent.phone, agent_email:primaryAgent.email, brokerage:parsed.brokerage}, current => '&' + filter('agent', current.agent) + '&' + filter('agent_phone', current.agent_phone));
    row = (await get(query))[0];
    if (!row || !samePerson(row.agent, primaryAgent.name) || phone(row.agent_phone) !== phone(primaryAgent.phone_normalized || primaryAgent.phone)) return null;
    const guard = '&' + filter('agent', row.agent) + '&' + filter('agent_phone', row.agent_phone);
    journal({type:'before-flags', table:'open_houses', id:row.id, before:{agent_scraped:row.agent_scraped,agent_enriched:row.agent_enriched}});
    const updated = await patch('/rest/v1/open_houses?id=eq.' + encodeURIComponent(openHouseId) + guard, {agent_scraped:true,agent_enriched:true});
    if (!updated?.length) throw new Error('Open-house identity changed before flags could be saved');
    return updated[0];
  }
  return { saveListingAgents, patchOpenHouseSuccess };
}
function fileJournal(directory) {
  fs.mkdirSync(directory, {recursive:true});
  const filename = path.join(directory, 'trulia-write-audit-' + new Date().toISOString().slice(0,10) + '.jsonl');
  return entry => fs.appendFileSync(filename, JSON.stringify({at:new Date().toISOString(),...entry}) + '\n', {encoding:'utf8',mode:0o600});
}
function acquireRunLock(directory) {
  fs.mkdirSync(directory, {recursive:true});
  const filename = path.join(directory, 'trulia-enrichment.lock');
  try {
    fs.writeFileSync(filename, JSON.stringify({pid:process.pid,at:new Date().toISOString()}), {flag:'wx',mode:0o600});
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let previous;
    try { previous = JSON.parse(fs.readFileSync(filename,'utf8')); } catch { throw new Error('Unreadable scraper lock; review the lock before retrying'); }
    if (!Number.isInteger(previous.pid) || previous.pid <= 0) throw new Error('Invalid scraper lock; review before retrying');
    try { process.kill(previous.pid,0); } catch (probeError) {
      if (probeError.code !== 'ESRCH') throw new Error('Cannot verify previous scraper process; refusing a duplicate run');
      fs.renameSync(filename,filename+'.stale-'+Date.now());
      return acquireRunLock(directory);
    }
    throw new Error('Another Trulia enrichment process is already running');
  }
  process.once('exit',()=>{
    try { const owner=JSON.parse(fs.readFileSync(filename,'utf8'));if(owner.pid===process.pid)fs.unlinkSync(filename); } catch {}
  });
}
module.exports = {phone,validName,samePerson,parseListingContacts,createStore,fileJournal,acquireRunLock};
