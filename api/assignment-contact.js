const { sendJson, supabaseRest } = require('../lib/admin-auth');
const { verifyContactToken, agentVcard } = require('../lib/assignment-contact');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.setHeader('Allow', 'GET, HEAD');
      return sendJson(res, 405, { error: 'Method not allowed.' });
    }
    const token = req.query?.token || new URL(req.url, 'https://rel8tion.local').searchParams.get('token');
    const claims = verifyContactToken(token);
    if (!claims) return sendJson(res, 403, { error: 'This contact link has expired or is invalid. Open your assigned open house for a new card.' });
    const { visitId, profileUid } = claims;
    const participants = await supabaseRest(`field_demo_visit_participants?field_demo_visit_id=eq.${visitId}&participant_profile_id=eq.${profileUid}&role=eq.loan_officer&responsibility=eq.financing_support&is_primary=eq.true&status=in.(assigned,confirmed,en_route,on_site,live)&select=id&limit=1`);
    if (!participants?.length) return sendJson(res, 403, { error: 'This assignment is no longer active.' });
    const visits = await supabaseRest(`field_demo_visits?id=eq.${visitId}&status=neq.cancelled&select=agent_name,agent_phone,agent_email,agent_slug,brokerage&limit=1`);
    if (!visits?.length) return sendJson(res, 404, { error: 'Open house not found.' });
    res.setHeader('Content-Type', 'text/vcard; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="hosting-agent.vcf"');
    res.statusCode = 200;
    return res.end(req.method === 'HEAD' ? undefined : agentVcard(visits[0]));
  } catch (_) {
    return sendJson(res, 500, { error: 'The contact card could not be loaded. Please try again.' });
  }
};
