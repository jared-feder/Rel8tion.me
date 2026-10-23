const { supabaseRest, sendJson } = require('../lib/admin-auth');
const { loadOneKeyListingAgents } = require('../lib/onekey-listing-agents');
const { usableAgentName } = require('../lib/agent-identity');

// Public listing attribution only: no claim, activation, SMS, or database writes.
module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
  const id = req.query?.open_house_id;
  if (typeof id !== 'string' || !/^[A-Za-z0-9_.:-]{1,120}$/.test(id)) {
    return sendJson(res, 400, { error: 'A valid open house ID is required' });
  }
  try {
    const rows = await supabaseRest(`open_houses?id=eq.${encodeURIComponent(id)}&select=id,address,source,lat,lng,agent,agent_phone,agent_email,brokerage&limit=1`);
    const house = rows?.[0];
    if (!house) return sendJson(res, 404, { error: 'Open house not found' });
    let agents;
    try {
      agents = await loadOneKeyListingAgents(house);
    } catch (error) {
      if (!usableAgentName(house.agent)) throw error;
      agents = [];
    }
    if (!agents.length && usableAgentName(house.agent)) {
      agents = [{ name: house.agent, phone: house.agent_phone || '', email: house.agent_email || '', brokerage: house.brokerage || '', open_house_id: id, is_primary: true }];
    }
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300');
    return res.status(200).json({ agents });
  } catch (error) {
    console.error('[listing-agents]', error.message);
    return sendJson(res, 503, { error: 'Agent details could not be loaded. Please try again.' });
  }
};
