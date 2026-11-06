const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),vm=require('node:vm');
const {createWorkspace}=require('../lib/assistant-workspace');
const {threads,memoryStore}=require('./fixtures/assistant-workspace.cjs');
const {publicConfig,subscriptionRecord,payloadFor,sendPush,deliverPushes}=require('../lib/assistant-push');
const owner={id:'jared',owner:true,threads:[]},cat={id:'cat',owner:false,threads:['sample-avery']};
function harness(){
  const rows=structuredClone(threads),store=memoryStore();let calls=0,ready=true,timeout=false,time=new Date('2026-11-06T16:00:00Z');
  const workspace=createWorkspace({store,now:()=>time,source:{inbox:async()=>rows,thread:async key=>rows.find(t=>t.thread_key===key)},transport:{ready:()=>ready,send:async record=>{calls++;if(timeout)throw new Error('Unknown network outcome');await store.transition(record,'accepted',{event:'accepted',actor:'mock-provider',at:time.toISOString()},{provider_receipt:{sid:'MOCK-ONLY',from:'+18448211802'}});}}});
  const input={action:'draft',request_id:'mock-dispatch-0001',thread_key:'sample-avery',in_reply_to:'sample-in-1',body:'Is Queens okay?'};
  return {rows,store,workspace,input,calls:()=>calls,configure:opts=>{if('ready'in opts)ready=opts.ready;if('timeout'in opts)timeout=opts.timeout;if(opts.time)time=new Date(opts.time);},approve:async()=>{const {action}=await workspace.act(cat,input);await workspace.act(owner,{action:'approve',id:action.id});return {action:'send',id:action.id,fingerprint:action.fingerprint};}};
}
test('only an owner can send an exactly approved, unchanged reply',async()=>{
  const h=harness();const draft=await h.workspace.act(cat,h.input);
  await assert.rejects(h.workspace.act(owner,{action:'send',id:draft.action.id,fingerprint:draft.action.fingerprint}),/Approve/);
  const send=await h.approve();await assert.rejects(h.workspace.act(cat,send),/Jared/);
  await assert.rejects(h.workspace.act(owner,{...send,fingerprint:'changed'}),/changed/);assert.equal(h.calls(),0);
  const result=await h.workspace.act(owner,send);assert.equal(result.action.status,'accepted');assert.equal(result.action.provider_receipt.sid,'MOCK-ONLY');assert.equal(h.calls(),1);
  await h.workspace.act(owner,send);assert.equal(h.calls(),1);
});
test('concurrent clicks and unknown network outcomes cannot resubmit a reply',async()=>{
  for(const timeout of [false,true]){const h=harness();h.configure({timeout});const send=await h.approve();await Promise.allSettled([h.workspace.act(owner,send),h.workspace.act(owner,send)]);await h.workspace.act(owner,send);assert.equal(h.calls(),1);assert.equal((await h.store.get(send.id)).status,timeout?'dispatching':'accepted');}
});
test('disabled transport, opt-out, new inbound, changed sender/phone and closed hours block submission',async()=>{
  for(const kind of ['disabled','optout','newer','sender','phone','hours']){const h=harness(),send=await h.approve();
    if(kind==='disabled')h.configure({ready:false});if(kind==='optout')h.rows[0].any_opt_out=true;
    if(kind==='newer')h.rows[0].messages.push({...h.rows[0].messages[1],id:'new',received_at:'2026-11-06T16:01:00Z'});
    if(kind==='sender')h.rows[0].messages[1].to_phone='+15165550123';if(kind==='phone')h.rows[0].agent_phone='+12025550109';if(kind==='hours')h.configure({time:'2026-11-07T03:00:00Z'});
    await assert.rejects(h.workspace.act(owner,send),kind);assert.equal(h.calls(),0);
  }
});
const env={ASSISTANT_VAPID_PUBLIC_KEY:'mock-public',ASSISTANT_VAPID_PRIVATE_KEY:'mock-private',ASSISTANT_VAPID_SUBJECT:'https://app.rel8tion.me'};
function subscription(){const key=crypto.createECDH('prime256v1');key.generateKeys();return {endpoint:'https://fcm.googleapis.com/fcm/send/mock-only',keys:{p256dh:key.getPublicKey().toString('base64url'),auth:Buffer.alloc(16,1).toString('base64url')}};}
test('push configuration exposes only public material and endpoints reject SSRF or malformed encryption',()=>{
  assert.equal(publicConfig({}).configured,false);assert.equal(publicConfig(env).sms_fallback,false);assert.equal(JSON.stringify(publicConfig(env)).includes('mock-private'),false);
  const value=subscription();assert.equal(subscriptionRecord(value).endpoint_hash.length,64);
  for(const endpoint of ['http://fcm.googleapis.com/a','https://localhost/a','https://fcm.googleapis.com.attacker.test/a','https://fcm.googleapis.com:8443/a','https://user@fcm.googleapis.com/a'])assert.throws(()=>subscriptionRecord({...value,endpoint}));
  assert.throws(()=>subscriptionRecord({...value,keys:{...value.keys,p256dh:Buffer.alloc(65).toString('base64url')}}));
});
test('push payloads contain generic review text and canonical conversation links only',async()=>{
  const e={id:'mock-event',thread_key:'lo:mock-contact',body:'PRIVATE CONTACT BODY'};const p=payloadFor(e);assert.equal(p.url,'https://app.rel8tion.me/command?area=assistant&thread=lo%3Amock-contact');assert.ok(!JSON.stringify(p).includes(e.body));
  let calls=0;await sendPush(subscription(),e,env,async(sub,body,opts)=>{calls++;assert.equal(opts.timeout,10000);assert.equal(JSON.parse(body).id,e.id);});assert.equal(calls,1);
});
test('missing push credentials touch neither store nor provider',async()=>{
  const result=await deliverPushes({env:{},store:new Proxy({},{get:()=>assert.fail('No database reads')}),send:()=>assert.fail('No send')});assert.equal(result.status,'configuration_required');
});
function pushHarness(status){
  const event={id:'mock-event',thread_key:'lo:mock',created_at:'2026-11-06T16:00:00Z'},sub={id:'mock-device',subscription:subscription(),created_at:'2026-11-06T15:59:00Z'};let claims=0,sends=0,disabled=0,finished=[];
  const store={events:async()=>[event],subscriptions:async()=>[sub],claim:async()=>claims++?null:{event_id:event.id,subscription_id:sub.id},finish:async(c,s,p)=>finished.push({status:s,...p}),disable:async()=>disabled++};
  return {event,sub,store,send:async()=>{sends++;if(status)throw {statusCode:status};},now:()=>new Date('2026-11-06T16:01:00Z'),sends:()=>sends,disabled:()=>disabled,finished};
}
test('push claims deduplicate; expired endpoints disable; only explicit throttling schedules retries',async()=>{
  for(const [status,outcome] of [[0,'submitted'],[410,'expired'],[429,'retry'],[500,'unknown']]){const h=pushHarness(status);await deliverPushes({...h,env});await deliverPushes({...h,env});assert.equal(h.sends(),1);assert.equal(h.finished[0].status,outcome);assert.equal(h.disabled(),status===410?1:0);}
});
test('new device subscriptions do not receive historical alerts and worker batches are bounded',async()=>{
  const h=pushHarness(0);h.sub.created_at='2026-11-06T16:00:30Z';await deliverPushes({...h,env});assert.equal(h.sends(),0);
  let sends=0;const events=Array.from({length:20},(_,i)=>({...h.event,id:'event-'+i}));const store={events:async()=>events,subscriptions:async()=>[{...h.sub,created_at:'2026-11-06T15:00:00Z'}],claim:async()=>({}),finish:async()=>{}};await deliverPushes({env,store,now:h.now,send:async()=>sends++});assert.equal(sends,5);
});
test('Twilio signatures bind exact URL, parameters and existing account token',async()=>{
  const source=fs.readFileSync('supabase/functions/_shared/assistant-inbound.ts','utf8');const stripped=require('node:module').stripTypeScriptTypes(source).replace(/export /g,'');const context=vm.createContext({crypto:crypto.webcrypto,TextEncoder,Uint8Array,atob,Date});vm.runInContext(stripped,context);
  const url='https://example.test/functions/v1/twilio-inbound-router',payload={From:'+12025550101',To:'+18448211802',Body:'Yes',AccountSid:'MOCK_ACCOUNT'},token='synthetic-signature-fixture';
  const text=url+Object.keys(payload).sort().map(k=>k+payload[k]).join(''),signature=crypto.createHmac('sha1',token).update(text).digest('base64');
  assert.equal(await context.verifyTwilioForm(url,payload,signature,token),true);assert.equal(await context.verifyTwilioForm(url,{...payload,Body:'spoof'},signature,token),false);assert.equal(await context.verifyTwilioForm(url+'?changed=1',payload,signature,token),false);assert.equal(await context.verifyTwilioForm(url,payload,signature,''),false);
});
test('public webhook cannot supply trusted contact attribution or cause paid owner alerts',()=>{
  const inbound=fs.readFileSync('supabase/functions/twilio-inbound-reply/index.ts','utf8');assert.match(inbound,/delete payload.assistant_profile_uid/);assert.match(inbound,/const queueRow=contactUid\?null:matchedQueue/);assert.doesNotMatch(inbound,/owner_fallback_alert|buildOwnerReplyAlert/);
  const sender=fs.readFileSync('supabase/functions/send-assistant-reply/index.ts','utf8');assert.match(sender,/is\("provider_claimed_at",null\)/);assert.match(sender,/expectedFrom:SENDER/);assert.doesNotMatch(sender,/internal_operational_alert:true|reply_to_recent_inbound:true/);
});

function edgeHarness(options={}){
  const record={id:'synthetic-edge-request',status:'dispatching',dispatch_token:'11111111-1111-4111-8111-111111111111',provider_claimed_at:null,recipient_phone:'+12025550101',sender:'+18448211802',body:"This is Cat from REL8TION, Jared's assistant. Is Queens okay?",in_reply_to:'inbound-mock',contact_profile_uid:'mock-profile',author:'jared',audit:[{event:'approved',actor:'jared'}]};
  const state={assistant_workspace_actions:[record],agent_outreach_replies:[{id:'inbound-mock',from_phone:'+12025550101',to_phone:'+18448211802',direction:'inbound',from_phone_normalized:'2025550101',opt_out:false}]};let handler,calls=0;
  const db={rpc:async()=>({data:true,error:null}),from:table=>{
    let patch=null,filters=[];
    const q={select:()=>q,update:p=>(patch=p,q),eq:(k,v)=>(filters.push(r=>r[k]===v),q),is:(k,v)=>(filters.push(r=>(r[k]??null)===v),q),order:()=>q,limit:()=>q,single:()=>q.maybeSingle(),maybeSingle:async()=>{
      const row=(state[table]||[]).find(r=>filters.every(f=>f(r)));if(row&&patch)Object.assign(row,structuredClone(patch));return {data:row?structuredClone(row):null,error:null};
    }};return q;
  }};
  let code=fs.readFileSync('supabase/functions/send-assistant-reply/index.ts','utf8').replace(/^import .*;\r?\n/gm,'');code=require('node:module').stripTypeScriptTypes(code);
  const RealDate=Date;class MockDate extends RealDate{constructor(value){super(value??'2026-11-06T16:00:00Z');}}
  const context=vm.createContext({serve:f=>handler=f,createClient:()=>db,Deno:{env:{get:name=>name==='SUPABASE_URL'?'https://example.test':'mock-service-fixture'}},sendSMS:async opts=>{calls++;assert.equal(opts.expectedFrom,'+18448211802');assert.equal(opts.metadata.assistant_request_id,record.id);assert.equal(opts.timeoutMs,20000);assert.equal(opts.metadata.internal_operational_alert,undefined);if(options.timeout)throw new Error('Uncertain timeout');return {ok:true,externalId:'MOCK-SID',status:'queued',from:'+18448211802'};},Response,Date:MockDate,Intl});vm.runInContext(code,context);
  return {record,state,calls:()=>calls,invoke:async(auth=true)=>{const response=await handler(new Request('https://example.test',{method:'POST',headers:{authorization:auth?'Bearer mock-service-fixture':'Bearer anon','content-type':'application/json'},body:JSON.stringify({id:record.id,dispatch_token:record.dispatch_token})}));return {status:response.status,body:await response.json()};}};
}
test('Edge transport enforces service authentication and atomic submission claim',async()=>{
  const h=edgeHarness();assert.equal((await h.invoke(false)).status,401);assert.equal(h.calls(),0);
  const results=await Promise.all([h.invoke(),h.invoke()]);assert.equal(h.calls(),1);assert.equal(h.record.status,'accepted');assert.equal(h.record.provider_receipt.sid,'MOCK-SID');assert.ok(results.some(r=>r.status===409));await h.invoke();assert.equal(h.calls(),1);
});
test('Edge revalidates new inbound and records uncertain provider outcomes without retry',async()=>{
  const changed=edgeHarness();changed.state.agent_outreach_replies[0].id='newer-incoming';await changed.invoke();assert.equal(changed.record.status,'blocked');assert.equal(changed.calls(),0);
  const timed=edgeHarness({timeout:true});await timed.invoke();assert.equal(timed.record.status,'unknown');await timed.invoke();assert.equal(timed.calls(),1);
});
