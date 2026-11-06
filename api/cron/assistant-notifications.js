const {cronAuthorized}=require('../../lib/outreach-cron-shared');
const {supabaseRest,sendJson}=require('../../lib/admin-auth');
const {deliverPushes}=require('../../lib/assistant-push');
const store={
  events:async()=>{
    // A crashed worker may have submitted already. Never retry that lease.
    await supabaseRest('assistant_push_deliveries?status=eq.sending&lease_expires_at=lt.'+encodeURIComponent(new Date().toISOString()),{method:'PATCH',body:JSON.stringify({status:'unknown'})});
    return supabaseRest('rpc/assistant_pending_push_events',{method:'POST',body:'{}'});
  },
  subscriptions:()=>supabaseRest('assistant_push_subscriptions?active=eq.true&owner_id=eq.jared&select=id,subscription,created_at&limit=100'),
  claim:async(event,subscription)=>{
    const rows=await supabaseRest('rpc/assistant_claim_push_delivery',{method:'POST',body:JSON.stringify({p_event:event.id,p_subscription:subscription.id})});
    return rows?.[0]||null;
  },
  finish:(claim,status,patch)=>supabaseRest(`assistant_push_deliveries?event_id=eq.${claim.event_id}&subscription_id=eq.${claim.subscription_id}&status=eq.sending&lease_token=eq.${claim.lease_token}`,{method:'PATCH',body:JSON.stringify({status,...patch})}),
  disable:id=>supabaseRest(`assistant_push_subscriptions?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify({active:false})})
};
module.exports=async(req,res)=>{
  if(req.method!=='GET')return sendJson(res,405,{ok:false,error:'Method not allowed.'});
  const auth=cronAuthorized(req);if(!auth.ok)return sendJson(res,401,{ok:false,error:auth.error});
  try{
    const reconciled=await supabaseRest('rpc/assistant_reconcile_receipts',{method:'POST',body:'{}'});
    return sendJson(res,200,{...await deliverPushes({store}),reconciled});
  }
  catch{return sendJson(res,503,{ok:false,error:'Push queue could not be processed. No SMS fallback was used.'});}
};
