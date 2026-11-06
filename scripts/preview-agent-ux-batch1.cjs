// Local synthetic review only. Never deploy this server or its fixture bypass.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const fixtures = path.join(root, 'test/fixtures/agent-dashboard');
const evidence = path.join(root, 'docs/ux-review-2026-11-06/batch-1/evidence');
let fixture = 'populated', extra = false, fail = false;
const buyer = (id,requested=false)=>({id,buyer_id:id,visitor_name:id==='buyer-a'?'Alex Fixture':'Sam Fixture',visitor_phone:'202-555-0100',visitor_email:'buyer@example.invalid',pre_approved:false,metadata:{financing_requested:requested},created_at:'2026-11-06T16:00:00Z'});
function snapshot(){return {ok:true,event:{id:'synthetic-event',host_agent_slug:'fixture-agent',status:'active',start_time:'2026-11-06T15:00:00Z',setup_context:fixture==='event-pass'?{flow:'event-pass'}:{}},
 sign:{id:'synthetic-sign',public_code:'SYNTHETIC',owner_agent_slug:'fixture-agent'},house:{address:'123 Preview Lane · Synthetic Listing',price:725000,beds:3,baths:2,sqft:1800},
 checkins:fixture==='empty'?[]:[buyer('buyer-a'),...(extra?[buyer('buyer-b',true)]:[])],outreach:[],loan_officer:null,membership_active:false};}
function send(res,code,body,type='text/html'){res.writeHead(code,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store',
 'Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; form-action 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'",'X-Content-Type-Options':'nosniff'});res.end(body);}
function controls(version){return `<aside style="font:14px Inter,sans-serif;background:#172554;color:white;padding:14px;position:relative;z-index:1" aria-label="Synthetic preview controls"><strong>Batch 1 · ${version.toUpperCase()} · SYNTHETIC DATA ONLY</strong><form action="/agent-dashboard" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px"><label>Version <select name="version" style="color:black"><option ${version==='after'?'selected':''}>after</option><option ${version==='before'?'selected':''}>before</option></select></label><label>Fixture <select name="fixture" style="color:black">${['populated','empty','event-pass','session-expired','missing-context'].map(x=>`<option ${fixture===x?'selected':''}>${x}</option>`).join('')}</select></label><button style="background:white;color:#172554;padding:4px 12px">Load fixture</button></form><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><button id="addFixture" style="background:white;color:#172554;padding:6px">Add synthetic check-in</button><button id="failFixture" style="background:white;color:#172554;padding:6px">Fail next reads</button><span id="fixtureStatus">All provider calls and live writes are blocked.</span><a href="/__capture" style="color:white;text-decoration:underline">Screenshot export</a></div></aside><script>
 document.getElementById('addFixture').onclick=async()=>{await fetch('/__control?add=1');document.getElementById('fixtureStatus').textContent='Second synthetic buyer added. Wait for 30-second refresh or select Refresh.';};
 document.getElementById('failFixture').onclick=async()=>{const r=await fetch('/__control?toggleFail=1');document.getElementById('fixtureStatus').textContent=await r.text();};
 document.addEventListener('click',e=>{const a=e.target.closest('a');if(a&&!a.getAttribute('href').startsWith('/__capture')){e.preventDefault();document.getElementById('fixtureStatus').textContent='Blocked preview navigation: '+a.textContent.trim();}});
 </script>`;}
const server=http.createServer(async(req,res)=>{
 if(!/^127\.0\.0\.1(?::\d+)?$/.test(req.headers.host||''))return send(res,403,'Loopback only.');
 const url=new URL(req.url,'http://127.0.0.1');
 if(req.method==='POST'&&url.pathname==='/__evidence'){
   let body='';for await(const part of req){body+=part;if(body.length>5000000)return send(res,413,'Too large');}
   const data=new URLSearchParams(body),name=data.get('name')||'';
   if(!/^(before|after|stale|recovery|input)-(desktop|320|390)\.jpg$/.test(name))return send(res,400,'Invalid evidence filename');
   const bytes=Buffer.from(data.get('image')||'','base64');if(bytes[0]!==255||bytes[1]!==216)return send(res,400,'JPEG required');
   fs.mkdirSync(evidence,{recursive:true});fs.writeFileSync(path.join(evidence,name),bytes);return send(res,200,'Saved '+name);
 }
 if(req.method!=='GET')return send(res,403,'All application writes are blocked in this synthetic preview.');
 if(url.pathname==='/__capture')return send(res,200,'<title>Screenshot export</title><h1>Local evidence export</h1><form method="POST" action="/__evidence"><label>Evidence filename <input name="name"></label><label>Screenshot data <textarea name="image"></textarea></label><button>Save screenshot</button></form>');
 if(url.pathname==='/__control'){
   if(url.searchParams.has('add'))extra=true;if(url.searchParams.has('toggleFail'))fail=!fail;
   return send(res,200,fail?'Fixture reads now fail. Select again to recover.':'Fixture reads restored. Select Refresh to recover.','text/plain');
 }
 if(url.pathname==='/api/agent-event-dashboard'){
   if(fixture==='session-expired')return send(res,401,JSON.stringify({ok:false,error:'Synthetic session expired.'}),'application/json');
   if(fail)return send(res,503,JSON.stringify({ok:false,error:'Synthetic read failure. Last good event is retained.'}),'application/json');
   if(url.searchParams.get('action')!=='snapshot')return send(res,403,'{}','application/json');
   return send(res,200,JSON.stringify(snapshot()),'application/json');
 }
 if(url.pathname==='/api/buyer-affordability')return send(res,200,JSON.stringify({ok:true,guidance:[{buyer_id:'buyer-a',max_monthly_housing_payment:4000,max_purchase_price_guidance:750000,rate_assumption_percent:6.5,loan_term_years:30}],scenarios:[]}), 'application/json');
 if(url.pathname==='/src/agent-dashboard-refresh.js')return send(res,200,fs.readFileSync(path.join(root,'apps/rel8tion-app/src/agent-dashboard-refresh.js')),'application/javascript');
 if(url.pathname.startsWith('/__assets/')){
   const name=url.pathname.slice(10);if(!/^[a-z0-9.-]+$/i.test(name))return send(res,404,'Missing asset');
   const file=path.join(fixtures,'assets',name);if(!fs.existsSync(file))return send(res,404,'Missing asset');
   return send(res,200,fs.readFileSync(file),name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':name.endsWith('.png')?'image/png':'font/woff2');
 }
 if(url.pathname==='/'||url.pathname==='/agent-dashboard'){
   fixture=url.searchParams.get('fixture')||'populated';extra=false;fail=false;
   const version=url.searchParams.get('version')==='before'?'before':'after';
   let html=fs.readFileSync(version==='before'?path.join(fixtures,'before.html'):path.join(root,'apps/rel8tion-app/agent-dashboard.html'),'utf8');
   html=html.replace(/https:\/\/fonts.googleapis.com\/[^"']+/g,'/__assets/fonts.css').replace('https://cdn.tailwindcss.com','/__assets/tailwind.js').replace(/https:\/\/rel8tion.me\/wp-content\/uploads\/2026\/04\/logo150x100trans.png/g,'/__assets/logo.png');
   html=html.replace('<body class=', '<body class=');
   html=html.replace('<main ',controls(version)+'<main ');
   html=html.replace('const params = new URLSearchParams(window.location.search);',`const params = new URLSearchParams(window.location.search); ${fixture==='missing-context'?'':"params.set('agent','fixture-agent');"}`);
   return send(res,200,html);
 }
 send(res,404,'Blocked: this route is not part of the synthetic fixture.');
});
if(require.main===module)server.listen(Number(process.env.UX_PREVIEW_PORT||4326),'127.0.0.1',()=>console.log('Synthetic dashboard review: http://127.0.0.1:4326/agent-dashboard'));
module.exports={server};
