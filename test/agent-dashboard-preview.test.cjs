const {test}=require('node:test');
const assert=require('node:assert/strict');
const {server}=require('../scripts/preview-agent-ux-batch1.cjs');
test('fixture server is loopback-only, locally styled and fails closed for every application write',async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 try{
  const page=await fetch(base+'/agent-dashboard');const html=await page.text();
  assert.match(page.headers.get('content-security-policy'),/connect-src 'self'/);
  assert.doesNotMatch(html,/src="https:\/\/cdn|href="https:\/\/fonts/);
  assert.match(html,/SYNTHETIC DATA ONLY/);
  for(const endpoint of ['/api/agent-event-dashboard','/api/buyer-affordability','/api/send-sms','/api/checkout','/unknown']){
   const response=await fetch(base+endpoint,{method:'POST',body:'{}'});assert.equal(response.status,403,endpoint);
  }
  assert.equal((await fetch(base+'/api/live-provider')).status,404);
  const payload=await (await fetch(base+'/api/agent-event-dashboard?action=snapshot')).json();assert.equal(payload.event.id,'synthetic-event');
 }finally{await new Promise(resolve=>server.close(resolve));}
});
