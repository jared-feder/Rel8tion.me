import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendSMS } from "../_shared/sms.ts";

const SENDER = "+18448211802";
const digits = (value: unknown) => String(value || "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
const json = (status: number, value: unknown) => new Response(JSON.stringify(value), { status, headers: { "Content-Type":"application/json", "Cache-Control":"no-store" } });

serve(async req => {
  if(req.method!=="POST")return json(405,{ok:false,error:"Method not allowed"});
  const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
  if(!key||req.headers.get("authorization")!==`Bearer ${key}`)return json(401,{ok:false,error:"Unauthorized"});
  const db=createClient(Deno.env.get("SUPABASE_URL")||"",key);
  const input=await req.json().catch(()=>({}));
  if(!/^[A-Za-z0-9_-]{12,100}$/.test(input.id||"")||!/^[0-9a-f-]{36}$/i.test(input.dispatch_token||""))return json(400,{ok:false,error:"Invalid dispatch reference"});
  let record: any = null;
  async function finish(status:string, receipt:Record<string,unknown>) {
    const {data:current,error:readError}=await db.from("assistant_workspace_actions").select("*").eq("id",input.id).single();
    if(readError)throw readError;
    if(!["dispatching","unknown"].includes(current.status)||current.dispatch_token!==input.dispatch_token)return current;
    const {data,error}=await db.from("assistant_workspace_actions").update({status,provider_receipt:receipt,audit:[...current.audit,{event:status,actor:"rel8tion-sms",at:new Date().toISOString()}]}).eq("id",input.id).eq("status",current.status).eq("dispatch_token",input.dispatch_token).select("*").maybeSingle();
    if(error)throw error;
    return data||current;
  }
  try {
    const {data,error}=await db.from("assistant_workspace_actions").select("*").eq("id",input.id).single();
    if(error)throw error;
    if(data.status!=="dispatching"||data.dispatch_token!==input.dispatch_token)return json(409,{ok:false,error:"Dispatch already handled or not approved"});
    // An atomic second claim also protects duplicate Edge invocations.
    const claimed=await db.from("assistant_workspace_actions").update({provider_claimed_at:new Date().toISOString(),audit:[...data.audit,{event:"provider_claimed",actor:"rel8tion-sms",at:new Date().toISOString()}]}).eq("id",data.id).eq("status","dispatching").eq("dispatch_token",input.dispatch_token).is("provider_claimed_at",null).select("*").maybeSingle();
    if(claimed.error)throw claimed.error;
    if(!claimed.data)return json(409,{ok:false,error:"Provider submission already claimed; do not resend"});
    record=claimed.data;
    const block=async(reason:string)=>json(409,{ok:false,action:await finish("blocked",{reason,submission_attempted:false})});
    if(record.sender!==SENDER||!/^\+1\d{10}$/.test(record.recipient_phone||"")||!record.body.startsWith("This is Cat from REL8TION, Jared's assistant."))return await block("Sender, identity or recipient is unverified");
    const hour=Number(new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",hour:"numeric",hourCycle:"h23"}).format(new Date()));
    if(hour<9||hour>=20)return await block("Outside the 9 AM to 8 PM New York reply window");
    let inboundQuery=db.from("agent_outreach_replies").select("id,from_phone,to_phone,opt_out").eq("direction","inbound").eq("to_phone",SENDER);
    if(record.queue_row_id){
      const queue=await db.from("agent_outreach_queue").select("agent_phone,agent_phone_normalized,review_status").eq("id",record.queue_row_id).single();
      if(queue.error)throw queue.error;
      if(/opted_out/.test(queue.data.review_status||"")||digits(queue.data.agent_phone_normalized||queue.data.agent_phone)!==digits(record.recipient_phone))return await block("Contact is opted out or its phone changed");
      inboundQuery=inboundQuery.eq("queue_row_id",record.queue_row_id);
    }else{
      const profile=await db.rpc("assistant_verified_direct_contact",{p_uid:record.contact_profile_uid,p_phone:record.recipient_phone});
      if(profile.error)throw profile.error;
      if(profile.data!==true)return await block("Direct contact is inactive or ambiguous");
      inboundQuery=inboundQuery.eq("from_phone_normalized",digits(record.recipient_phone));
    }
    const incoming=await inboundQuery.order("received_at",{ascending:false}).order("id",{ascending:false}).limit(1).maybeSingle();
    if(incoming.error)throw incoming.error;
    if(!incoming.data||incoming.data.id!==record.in_reply_to||incoming.data.opt_out||digits(incoming.data.from_phone)!==digits(record.recipient_phone))return await block("The latest incoming message, recipient or opt-out state changed");
    const sms=await sendSMS({supabase:db,to:record.recipient_phone,body:record.body,category:"manual_outreach",providerOverride:"twilio",expectedFrom:SENDER,timeoutMs:20000,metadata:{source:"jared-assistant",assistant_author:"cat",assistant_identity:record.identity,assistant_request_id:record.id,operator_id:record.author,approved_by:record.audit.findLast((e:any)=>e.event==="approved")?.actor,verified_profile_uid:record.contact_profile_uid||null,queue_row_id:record.queue_row_id||null,omit_repeated_stop_disclosure:true}});
    const sid=sms.externalId||sms.sid;
    if(!sms.ok||!sid||sms.from!==SENDER)return json(200,{ok:true,action:await finish("unknown",{sid:sid||null,status:sms.status,reason:"Unexpected provider receipt; inspect before any further action",submission_attempted:true})});
    const action=await finish("accepted",{sid,status:sms.status,from:sms.from,to:record.recipient_phone,provider:"twilio",accepted_at:new Date().toISOString(),submission_attempted:true});
    // The provider receipt remains authoritative if history persistence fails.
    if(record.queue_row_id)await db.from("agent_outreach_replies").upsert({queue_row_id:record.queue_row_id,from_phone:SENDER,from_phone_normalized:digits(SENDER),to_phone:record.recipient_phone,body:record.body,message_sid:sid,direction:"outbound",opt_out:false,raw_payload:{source:"jared-assistant",assistant_request_id:record.id},received_at:new Date().toISOString()},{onConflict:"message_sid"});
    return json(200,{ok:true,action});
  }catch(err){
    const error=err as any;
    if(!record)return json(500,{ok:false,error:"Dispatch claim could not be verified. Do not resend."});
    const blocked=["sms_suppressed","sms_suppression_check_failed","sms_quiet_hours","sms_twilio_config_missing","sms_sender_mismatch"].includes(error.code);
    const status=blocked?"blocked":error.providerHttpStatus>=400&&error.providerHttpStatus<500?"failed":"unknown";
    try{return json(200,{ok:true,action:await finish(status,{reason:blocked?error.code:"Provider submission could not be confirmed",submission_attempted:!blocked})});}
    catch{return json(500,{ok:false,error:"Dispatch outcome is unverified. Do not resend; refresh the saved request."});}
  }
});
