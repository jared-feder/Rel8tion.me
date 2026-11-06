const {SENDER} = require('./assistant-workspace');
const digits = value => String(value||'').replace(/\D/g,'').replace(/^1(?=\d{10}$)/,'');
async function directThreads(rest) {
  const logs = await rest('sms_message_log?metadata->>source=eq.jared-assistant&select=id,to_phone,body,status,external_id,metadata,created_at&order=created_at.desc&limit=200');
  if(!logs.length)return [];
  const profiles=[];
  // Uniqueness must include every active profile, including shared-phone records
  // beyond the first REST page. A bounded incomplete scan fails closed.
  for(let page=0;;page++){
    if(page===10)throw new Error('Profile directory limit reached; direct contact identity is unverified.');
    const rows=await rest(`verified_profiles?is_active=eq.true&select=uid,full_name,title,company_name,phone&order=uid.asc&limit=1000&offset=${page*1000}`);
    profiles.push(...rows);if(rows.length<1000)break;
  }
  const groups=new Map();
  for(const log of logs){
    const matches=profiles.filter(p=>digits(p.phone)===digits(log.to_phone));
    if(matches.length!==1||log.metadata?.verified_profile_uid!==matches[0].uid)continue;
    const profile=matches[0],key=`lo:${profile.uid}`;
    if(!groups.has(key))groups.set(key,{thread_key:key,queue_row_id:null,agent_name:profile.full_name,agent_phone:profile.phone,brokerage:profile.company_name,contact_type:'loan_officer',contact_profile_uid:profile.uid,review_status:'awaiting_reply',messages:[]});
    groups.get(key).messages.push({id:log.id,direction:'outbound',body:log.body,received_at:log.created_at,message_sid:log.external_id,assistant_author:log.metadata.assistant_author==='cat'?'cat':null,assistant_identity:log.metadata.assistant_identity,provider_status:log.metadata.provider_status||log.status,from_phone:log.metadata.provider_from||null});
  }
  await Promise.all([...groups.values()].map(async thread=>{
    const phone=digits(thread.agent_phone);
    const replies=await rest(`agent_outreach_replies?from_phone_normalized=eq.${encodeURIComponent(phone)}&to_phone=eq.${encodeURIComponent(SENDER)}&direction=eq.inbound&select=id,body,direction,from_phone,to_phone,opt_out,message_sid,received_at,created_at&order=received_at.desc&limit=100`);
    thread.messages.push(...replies);thread.messages.sort((a,b)=>new Date(a.received_at||a.created_at)-new Date(b.received_at||b.created_at));
    thread.any_opt_out=replies.some(r=>r.opt_out);const last=thread.messages.at(-1);thread.review_status=thread.any_opt_out?'opted_out':last?.direction==='inbound'?'needs_reply':'awaiting_reply';
  }));
  return [...groups.values()];
}
module.exports={directThreads,digits};
