const crypto=require('node:crypto');
function publicConfig(env=process.env){
  const configured=!!(env.ASSISTANT_VAPID_PUBLIC_KEY&&env.ASSISTANT_VAPID_PRIVATE_KEY&&env.ASSISTANT_VAPID_SUBJECT);
  return {configured,public_key:configured?env.ASSISTANT_VAPID_PUBLIC_KEY:null,channel:'web_push',sms_fallback:false};
}
function subscriptionRecord(value){
  let url;try{url=new URL(value?.endpoint);}catch{throw Object.assign(new Error('Invalid push endpoint.'),{status:400});}
  const host=url.hostname.toLowerCase();
  const allowed=['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com'].includes(host)||/^[a-z0-9-]+\.notify\.windows\.com$/.test(host);
  if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash||!allowed||url.href.length>2048)throw Object.assign(new Error('Unsupported push service endpoint.'),{status:400});
  const keys=value?.keys;
  if(!keys||!/^[A-Za-z0-9_-]{87}$/.test(keys.p256dh||'')||!/^[A-Za-z0-9_-]{22}$/.test(keys.auth||'')||Buffer.from(keys.p256dh,'base64url').length!==65||Buffer.from(keys.auth,'base64url').length!==16)throw Object.assign(new Error('Invalid push encryption keys.'),{status:400});
  try { crypto.ECDH.convertKey(Buffer.from(keys.p256dh,'base64url'),'prime256v1'); } catch { throw Object.assign(new Error('Invalid push public key.'),{status:400}); }
  return {endpoint_hash:crypto.createHash('sha256').update(url.href).digest('hex'),subscription:{endpoint:url.href,keys:{p256dh:keys.p256dh,auth:keys.auth},expirationTime:null}};
}
function payloadFor(event){
  return {id:event.id,title:"Jared's Assistant",body:'A conversation needs your review.',url:`https://app.rel8tion.me/command?area=assistant&thread=${encodeURIComponent(event.thread_key)}`,tag:`assistant:${event.id}`};
}
async function sendPush(subscription,event,env=process.env,sender){
  if(!publicConfig(env).configured)throw Object.assign(new Error('Web Push is not configured.'),{statusCode:503,notSubmitted:true});
  const validated=subscriptionRecord(subscription).subscription;
  // Importing does not generate a VAPID key. Production keys must be separately
  // approved, configured server-side and never returned to the browser.
  const webpush=sender?null:require('web-push');
  return (sender||webpush.sendNotification)(validated,JSON.stringify(payloadFor(event)),{vapidDetails:{subject:env.ASSISTANT_VAPID_SUBJECT,publicKey:env.ASSISTANT_VAPID_PUBLIC_KEY,privateKey:env.ASSISTANT_VAPID_PRIVATE_KEY},TTL:86400,timeout:10000,urgency:'high',topic:crypto.createHash('sha256').update(event.id).digest('base64url').slice(0,32)});
}
async function deliverPushes({store,send=sendPush,env=process.env,now=()=>new Date()}){
  if(!publicConfig(env).configured)return {ok:true,status:'configuration_required',submitted:0};
  const [events,subscriptions]=await Promise.all([store.events(),store.subscriptions()]);
  let submitted=0,unknown=0,expired=0,attempted=0;
  for(const event of events)for(const subscription of subscriptions){
    if(attempted>=5)return {ok:true,status:'bounded',submitted,unknown,expired};
    if(new Date(event.created_at)<new Date(subscription.created_at)||now()-new Date(event.created_at)>86400000)continue;
    const claim=await store.claim(event,subscription);
    if(!claim)continue;
    attempted++;
    try{
      await send(subscription.subscription,event,env);
      await store.finish(claim,'submitted',{submitted_at:now().toISOString()});submitted++;
    }catch(error){
      if(error.statusCode===404||error.statusCode===410){await store.disable(subscription.id);await store.finish(claim,'expired',{});expired++;}
      else if(error.statusCode===429){await store.finish(claim,'retry',{next_attempt_at:new Date(now().getTime()+300000).toISOString()});}
      else {await store.finish(claim,'unknown',{});unknown++;}
      // No email or SMS fallback exists, and unknown acceptance is never retried.
    }
  }
  return {ok:true,status:'processed',submitted,unknown,expired};
}
module.exports={publicConfig,subscriptionRecord,payloadFor,sendPush,deliverPushes};
