const crypto = require('node:crypto');
const SENDER = '+18448211802';
const IDENTITY = "Cat from REL8TION, Jared's assistant";
const {checkCalendar} = require('./assistant-calendar');
const {createDispatcher} = require('./assistant-dispatch');
function fail(status, message) { const error = new Error(message); error.status = status; throw error; }
function latest(thread) {
  return [...(thread.messages || [])].filter(m => m.direction === 'inbound')
    .sort((a,b) => new Date(b.received_at || b.created_at) - new Date(a.received_at || a.created_at))[0];
}
function eligible(thread, at) {
  if (!thread || (!thread.queue_row_id && !(thread.contact_type==='loan_officer'&&thread.contact_profile_uid))) fail(409, 'A verified contact thread is required. Unlinked contacts need review.');
  if (thread.any_opt_out || thread.latest_reply_opt_out || /opted_out/.test(thread.review_status || '') || (thread.messages || []).some(m => m.opt_out)) fail(409, 'Contact has opted out.');
  const incoming = latest(thread);
  if (!incoming?.id) fail(409, 'No incoming message is available to reply to.');
  if (incoming.to_phone !== SENDER) fail(409, 'Incoming sender route is not the REL8TION number.');
  const digits=value=>String(value||'').replace(/\D/g,'').replace(/^1(?=\d{10}$)/,'');
  if(incoming.from_phone&&digits(incoming.from_phone)!==digits(thread.agent_phone||thread.agent_phone_normalized))fail(409,'Contact phone changed. Verify the recipient before replying.');
  const parts = new Intl.DateTimeFormat('en-US', {timeZone:'America/New_York',hour:'numeric',hourCycle:'h23'}).formatToParts(at);
  const hour = Number(parts.find(p => p.type === 'hour').value);
  if (hour < 9 || hour >= 20) fail(409, 'Outside the 9 AM to 8 PM America/New_York send window.');
  return incoming;
}
function hash(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function notifications(threads) {
  const seen = new Set();
  return threads.flatMap(thread => {
    const message = latest(thread);
    const important=/\b(available|confirm|confirmed|cancel|cancelled|reschedule|call me|callback|can you|what time|need your|please review|decision)\b/i.test(message?.body || '')||thread.contact_type==='loan_officer'&&/^(yes|y)\s*[.!]?$/i.test(message?.body||'');
    if (!message || thread.any_opt_out || thread.latest_reply_opt_out || /opted_out/.test(thread.review_status || '') || !important) return [];
    const id = `review:${message.message_sid || message.id}`;
    if (seen.has(id)) return [];
    seen.add(id);
    return [{id,thread_key:thread.thread_key,title:'Jared: review incoming reply',body:`${thread.agent_name || 'Contact'}: ${String(message.body).slice(0,180)}`,channel:'simulated_push',task:'review_incoming'}];
  });
}
function createWorkspace({source, store, transport, now = () => new Date()}) {
  async function threadFor(actor, key) {
    if (!actor.owner && !actor.threads.includes(key)) fail(403, 'Thread is outside this connection scope.');
    const thread = await source.thread(key);
    if (!thread || thread.thread_key !== key) fail(404, 'Thread not found.');
    return thread;
  }
  const dispatch=createDispatcher({store,threadFor,eligible,transport,now,fail});
  return {
    async resolveLatest(actor, key) {
      if(actor.businessOnly)fail(403,'This session may read business context only.');
      const keys = key ? [key] : (await source.inbox()).filter(t=>actor.owner || actor.threads.includes(t.thread_key)).map(t=>t.thread_key);
      const threads = await Promise.all(keys.map(threadKey=>threadFor(actor,threadKey)));
      const candidates = threads.map(thread=>({thread,incoming:latest(thread)})).filter(row=>row.incoming?.id)
        .sort((a,b)=>new Date(b.incoming.received_at||b.incoming.created_at)-new Date(a.incoming.received_at||a.incoming.created_at));
      if(!candidates.length)fail(404,'No incoming message in this connection scope.');
      const first=candidates[0], time=new Date(first.incoming.received_at||first.incoming.created_at).getTime();
      if(!Number.isFinite(time)||candidates[1]&&new Date(candidates[1].incoming.received_at||candidates[1].incoming.created_at).getTime()===time)fail(409,'Latest conversation is ambiguous. Select a contact.');
      // Return the exact message, contact and property for the caller to review.
      const calendar=source.calendar?await source.calendar():null;
      return {ok:true,thread_key:first.thread.thread_key,in_reply_to:first.incoming.id,thread:first.thread,calendar,booking_check:checkCalendar(calendar,first.thread)};
    },
    async read(actor) {
      const threads = (await source.inbox()).filter(t => actor.owner || actor.businessOnly || actor.threads.includes(t.thread_key));
      const actions = actor.businessOnly?[]:(await store.list()).filter(a => actor.owner || actor.threads.includes(a.thread_key));
      let calendar={verified:false,bookings:[],error:'Calendar is not connected.'};
      if(source.calendar)try{calendar=await source.calendar();}catch(error){calendar.error='Bookings could not be refreshed. Verify the schedule before committing.';}
      const booking_checks=Object.fromEntries(threads.map(thread=>[thread.thread_key,checkCalendar(calendar,thread)]));
      return {ok:true, mode:source.mode||'simulation', sending_ready:!!transport?.ready(), sender:SENDER, identity:IDENTITY, threads, actions, calendar, booking_checks, permissions:actor.scopes||[], notifications:notifications(threads), loaded_at:now().toISOString()};
    },
    async act(actor, input) {
      if(actor.businessOnly)fail(403,'This session may read business context only.');
      if(input.action==='send')return dispatch(actor,input);
      if (input.action === 'draft') {
        const thread = await threadFor(actor, input.thread_key);
        const incoming = latest(thread);
        const text = String(input.body || '').trim();
        if (!text || text.length > 1200) fail(400, 'Reply must be 1 to 1200 characters.');
        if (!/^[a-zA-Z0-9_-]{12,100}$/.test(input.request_id || '')) fail(400, 'A stable request_id is required.');
        const body = `This is ${IDENTITY}. ${text}`;
        const fingerprint = hash([thread.thread_key, input.in_reply_to, body, SENDER, actor.id]);
        const old = await store.get(input.request_id);
        if (old) { if (old.fingerprint !== fingerprint) fail(409, 'Request id already belongs to another reply.'); return {ok:true,action:old}; }
        if (!incoming?.id || incoming.id !== input.in_reply_to) fail(409, 'Latest incoming message changed. Read the conversation again.');
        const record = {id:input.request_id, thread_key:thread.thread_key, in_reply_to:incoming.id, body, sender:SENDER,
          recipient_phone:(()=>{const p=String(thread.agent_phone||thread.agent_phone_normalized||'').replace(/\D/g,'').replace(/^1(?=\d{10}$)/,'');return p.length===10?'+1'+p:null;})(),
          queue_row_id:thread.queue_row_id||null,contact_profile_uid:thread.contact_profile_uid||null,
          author:actor.id, identity:IDENTITY, fingerprint, status:'pending_approval', created_at:now().toISOString(),
          audit:[{event:'drafted',actor:actor.id,at:now().toISOString()}]};
        return {ok:true,action:await store.insert(record)};
      }
      const record = await store.get(input.id);
      if (!record) fail(404, 'Assistant item not found.');
      const thread = await threadFor(actor, record.thread_key);
      if (input.action === 'approve') {
        if (!actor.owner) fail(403, 'Only Jared can approve a reply.');
        if (record.status !== 'pending_approval') return {ok:true,action:record};
        if (latest(thread)?.id !== record.in_reply_to) fail(409, 'Incoming message changed. Create a fresh draft.');
        return {ok:true,action:await store.transition(record, 'approved', {event:'approved',actor:actor.id,at:now().toISOString()})};
      }
      if (input.action === 'simulate') {
        if (record.status === 'simulated') return {ok:true,action:record};
        if (record.status !== 'approved') fail(409, 'Jared must approve this exact reply first.');
        const incoming = eligible(thread, now());
        if (incoming.id !== record.in_reply_to) fail(409, 'Incoming message changed. Create a fresh draft.');
        // Intentionally no provider invocation. This branch cannot deliver SMS.
        return {ok:true,action:await store.transition(record, 'simulated', {event:'simulated_only',actor:actor.id,at:now().toISOString()})};
      }
      if (input.action === 'dismiss') {
        if (!actor.owner) fail(403, 'Only Jared can dismiss an item.');
        if (!['pending_approval','approved'].includes(record.status)) fail(409, 'Item is already complete.');
        return {ok:true,action:await store.transition(record,'dismissed',{event:'dismissed',actor:actor.id,at:now().toISOString()})};
      }
      fail(400, 'Unsupported assistant action.');
    }
  };
}
module.exports = {createWorkspace, latest, eligible, notifications, SENDER, IDENTITY, fail};
