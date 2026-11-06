const {authorize}=require('../../lib/assistant-auth');
const {supabaseRest,sendJson}=require('../../lib/admin-auth');
const {publicConfig,subscriptionRecord}=require('../../lib/assistant-push');
module.exports=async(req,res)=>{
  try{
    if(!['GET','POST'].includes(req.method))return sendJson(res,405,{ok:false,error:'Method not allowed.'});
    const actor=authorize(req);
    if(!actor.owner||!actor.scopes.includes('push'))return sendJson(res,403,{ok:false,error:'Owner authentication is required for push settings.'});
    const origin=req.headers?.origin;
    if(origin&&origin!=='https://app.rel8tion.me')return sendJson(res,403,{ok:false,error:'Use the production COMMAND page to manage this device.'});
    const config=publicConfig();
    if(req.method==='GET')return sendJson(res,200,{ok:true,...config});
    const body=typeof req.body==='string'?JSON.parse(req.body):req.body||{};
    const record=subscriptionRecord(body.subscription);
    if(body.action==='disable'){
      await supabaseRest(`assistant_push_subscriptions?endpoint_hash=eq.${record.endpoint_hash}&owner_id=eq.jared`,{method:'PATCH',body:JSON.stringify({active:false})});
      return sendJson(res,200,{ok:true,active:false});
    }
    if(body.action!=='subscribe')return sendJson(res,400,{ok:false,error:'Unsupported push setting.'});
    if(!config.configured)return sendJson(res,503,{ok:false,error:'Web Push needs its separately approved server key. No subscription was saved.'});
    await supabaseRest('assistant_push_subscriptions?on_conflict=endpoint_hash',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({...record,owner_id:'jared',active:true,created_at:new Date().toISOString()})});
    sendJson(res,200,{ok:true,active:true});
  }catch(error){sendJson(res,error.status||500,{ok:false,error:error.status?error.message:'Push settings could not be saved.'});}
};
