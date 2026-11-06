const {sendJson,supabaseRest,adminAuthorized} = require('../../lib/admin-auth');
const {authorize} = require('../../lib/assistant-auth');
const {createWorkspace,fail} = require('../../lib/assistant-workspace');
const {assistantSource} = require('./outreach-inbox');
const {loadCalendar} = require('../../lib/assistant-calendar');
const {directThreads} = require('../../lib/assistant-direct');
const table = 'assistant_workspace_actions';
const store = {
  list:()=>supabaseRest(`${table}?select=*&order=created_at.desc&limit=200`),
  get:async id=>(await supabaseRest(`${table}?id=eq.${encodeURIComponent(id)}&select=*&limit=1`))[0],
  insert:async record=>{
    try { return (await supabaseRest(table,{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(record)}))[0]; }
    catch(error) { if (error.status === 409) { const old=await store.get(record.id); if(old?.fingerprint===record.fingerprint)return old; } throw error; }
  },
  transition:async(record,status,event)=>{
    const rows=await supabaseRest(`${table}?id=eq.${encodeURIComponent(record.id)}&status=eq.${record.status}`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({status,audit:[...record.audit,event]})});
    if(!rows.length) fail(409,'Item changed. Refresh before continuing.');
    return rows[0];
  }
};
const workspace=createWorkspace({store,source:{
  mode:'live_context',
  calendar:()=>loadCalendar(supabaseRest),
  inbox:async()=>{
    const [outreach,direct]=await Promise.all([assistantSource.enrichInboxRows(await assistantSource.loadInboxRows(100)),directThreads(supabaseRest)]);
    return [...direct,...outreach];
  },
  thread:async key=>{
    if(key.startsWith('lo:'))return (await directThreads(supabaseRest)).find(t=>t.thread_key===key)||null;
    const detail=await assistantSource.loadThread(key);
    if(!detail.thread)return null;
    const queueId=detail.thread.queue_row_id;
    const messages=queueId ? await supabaseRest(`agent_outreach_replies?queue_row_id=eq.${encodeURIComponent(queueId)}&select=id,queue_row_id,from_phone,to_phone,body,direction,opt_out,message_sid,received_at,created_at&order=received_at.desc,id.desc&limit=200`) : [];
    return {...detail.thread,messages:messages.reverse()};
  }
}});
module.exports=async(req,res)=>{
  try {
    if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return sendJson(res,405,{ok:false,error:'Method not allowed.'});}
    let actor;
    try{actor=authorize(req);}catch(error){
      // Existing COMMAND access can read its existing business context. All new
      // draft/approval writes still require the stronger header token/capability.
      const reader=req.method==='GET'&&adminAuthorized({headers:{'x-admin-uid':req.headers?.['x-admin-uid']}});
      if(!reader?.ok)throw error;
      actor={owner:true,id:`command-reader:${reader.uid}`,threads:[],scopes:['read']};
    }
    let input={};
    if(req.method==='POST') { try { input=typeof req.body==='string'?JSON.parse(req.body):req.body||{}; }catch{fail(400,'Invalid JSON.');} }
    const scope=req.method==='GET'||input.action==='resolve_latest'?'read':input.action;
    if(!actor.scopes.includes(scope))fail(403,'This connection does not permit that action.');
    const result=req.method==='GET'?await workspace.read(actor):input.action==='resolve_latest'?await workspace.resolveLatest(actor,input.thread_key):await workspace.act(actor,input);
    sendJson(res,200,result);
  }catch(error){sendJson(res,error.status||500,{ok:false,error:error.message||'Assistant workspace unavailable.'});}
};
