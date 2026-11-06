// Helpers have no provider side effects; caller supplies its existing service client.
export async function verifyTwilioForm(url:string,payload:Record<string,unknown>,signature:string,token:string){
  if(!token||!signature)return false;
  let bytes:Uint8Array;try{bytes=Uint8Array.from(atob(signature),c=>c.charCodeAt(0));}catch{return false;}
  const text=url+Object.keys(payload).sort().map(k=>k+String(payload[k]??'')).join('');
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(token),{name:'HMAC',hash:'SHA-1'},false,['verify']);
  return crypto.subtle.verify('HMAC',key,new Uint8Array(bytes).buffer,new TextEncoder().encode(text));
}
export async function assistantContact(db:any,phone:string,lastOutreach:string|null){
  const {data,error}=await db.from('sms_message_log').select('metadata,created_at,status,external_id').eq('to_phone',phone).eq('metadata->>source','jared-assistant').not('external_id','is',null).gte('created_at',new Date(Date.now()-7*86400000).toISOString()).order('created_at',{ascending:false}).limit(1).maybeSingle();
  if(error)throw error;
  if(!data||['failed','undelivered','blocked','canceled'].includes(data.metadata?.provider_status||data.status)||lastOutreach&&new Date(lastOutreach)>new Date(data.created_at))return null;
  const uid=data.metadata?.verified_profile_uid;
  if(!uid)return null;
  const result=await db.rpc('assistant_verified_direct_contact',{p_uid:uid,p_phone:phone});
  if(result.error)throw result.error;
  return result.data===true?uid:null;
}
