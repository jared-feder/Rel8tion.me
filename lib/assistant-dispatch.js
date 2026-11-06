const crypto = require('node:crypto');
function createDispatcher({store,threadFor,eligible,transport,now,fail}) {
  return async function send(actor,input) {
    if(!actor.owner)fail(403,'Jared must approve and send this exact reply.');
    let record=await store.get(input.id);
    if(!record)fail(404,'Assistant reply not found.');
    if(['dispatching','accepted','delivered','failed','blocked','unknown'].includes(record.status))return {ok:true,action:record};
    if(record.status!=='approved')fail(409,'Approve the saved reply before sending.');
    if(input.fingerprint!==record.fingerprint)fail(409,'The approved reply changed. Review it again.');
    const thread=await threadFor(actor,record.thread_key),incoming=eligible(thread,now());
    if(incoming.id!==record.in_reply_to)fail(409,'A newer reply arrived. Create and approve a fresh draft.');
    if(!record.recipient_phone)fail(409,'This older draft has no verified recipient. Create a fresh draft.');
    if(!transport?.ready())fail(503,'Manual sending is not configured. No message was submitted.');
    // A compare-and-set claim precedes the only provider submission. Neither
    // an HTTP retry nor an uncertain outcome ever re-enters the transport.
    record=await store.transition(record,'dispatching',{event:'send_requested',actor:actor.id,at:now().toISOString()},{dispatch_token:crypto.randomUUID()});
    try { await transport.send(record); }
    catch { /* The Edge function may still complete. Read durable state, never resend. */ }
    try { return {ok:true,action:await store.get(record.id)}; }
    catch { return {ok:true,action:record,warning:'Submission outcome is unverified. Refresh this item; do not create a replacement send.'}; }
  };
}
module.exports={createDispatcher};
