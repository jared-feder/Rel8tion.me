const assert = require('node:assert/strict');
const {test} = require('node:test');
const {phone,samePerson,parseListingContacts,createStore} = require('./trulia-safe-store.cjs');
const agent = {name:'Alice M. Rivera ABR',phone:'(516) 555-0123',phone_normalized:'5165550123',email:'alice@example.test'};
function fixture(initialAgents=[], house={}) {
  const tables={listing_agents:structuredClone(initialAgents),open_houses:[{id:'event-1',agent:null,agent_phone:null,...house}]};
  const audit=[],writes=[];
  function matching(table,params) {
    return tables[table].filter(row=> [...params].every(([key,value])=> {
      if(key==='select'||key==='on_conflict')return true;
      if(value==='is.null')return row[key]==null;
      if(value.startsWith('eq.'))return String(row[key]??'')===value.slice(3);
      throw Error('Unexpected filter '+value);
    }));
  }
  function parse(url){const u=new URL('https://test.invalid'+url);return [u.pathname.split('/').pop(),u.searchParams];}
  const store=createStore({
    journal:entry=>audit.push(entry),log:()=>{},
    get:async url=>{const [t,p]=parse(url);return structuredClone(matching(t,p));},
    post:async(url,rows)=>{const[t]=parse(url);for(const row of rows){if(!tables[t].some(x=>x.open_house_id===row.open_house_id&&x.phone_normalized===row.phone_normalized)){tables[t].push({id:'la-'+(tables[t].length+1),...row});writes.push({table:t,type:'insert',row});}}return [];},
    patch:async(url,body)=>{const[t,p]=parse(url);const rows=matching(t,p);for(const row of rows){writes.push({table:t,type:'patch',body});Object.assign(row,body);}return structuredClone(rows);}
  });return {store,tables,audit,writes};
}
test('parses company, adjacent-line phone and email without treating company as person',()=>{
  const parsed=parseListingContacts('Listing by:\nCompass\nAlice Rivera\n(516) 555-0123\nalice@example.test\nBob Jones (516) 555-0456\nSource: OneKey');
  assert.equal(parsed.brokerage,'Compass');assert.equal(parsed.agents.length,2);assert.equal(parsed.agents[0].email,'alice@example.test');
});
test('does not merge distinct people sharing an office phone',()=>{
  assert.equal(samePerson('Alice Rivera','Bob Rivera'),false);assert.equal(samePerson('Alice M Rivera ABR','Alice Rivera'),true);assert.equal(phone('123'), '');
});
test('preserves existing company, email and all photo fields',async()=>{
  const existing={id:'la-1',open_house_id:'event-1',name:'Alice Rivera',phone:'5165550123',phone_normalized:'5165550123',brokerage:'Verified Co',email:'saved@example.test',primary_photo_url:'verified.jpg',photo_enriched:true};
  const f=fixture([existing]);const saved=await f.store.saveListingAgents('event-1',{brokerage:'Other Co',agents:[agent]});
  assert.equal(saved.length,1);assert.deepEqual(f.tables.listing_agents[0],existing);assert.equal(f.writes.length,0);
});
test('fills missing name, phone, company and email and verifies insertion',async()=>{
  const f=fixture();const saved=await f.store.saveListingAgents('event-1',{brokerage:'Compass',agents:[agent]});
  assert.equal(saved[0].email,agent.email);assert.equal(saved[0].brokerage,'Compass');assert.ok(f.audit.some(x=>x.type==='before-insert'));
  await f.store.patchOpenHouseSuccess('event-1',saved[0],{brokerage:'Compass'});
  assert.equal(f.tables.open_houses[0].agent_email,agent.email);assert.equal(f.tables.open_houses[0].brokerage,'Compass');assert.equal(f.tables.open_houses[0].agent_enriched,true);
});
test('preserves shared-phone conflicts and primary attribution instead of overwriting',async()=>{
  const f=fixture([{id:'la-1',open_house_id:'event-1',name:'Bob Jones',phone:'5165550123',phone_normalized:'5165550123'}],{agent:'Bob Jones',agent_phone:'5165550456',agent_enriched:true});
  assert.equal((await f.store.saveListingAgents('event-1',{brokerage:'Compass',agents:[agent]})).length,0);
  assert.equal(await f.store.patchOpenHouseSuccess('event-1',agent,{brokerage:'Compass'}),null);assert.equal(f.writes.length,0);assert.equal(f.tables.open_houses[0].agent_enriched,true);
});
test('fills blank listing name before company using current identity guards',async()=>{
  const f=fixture([{id:'la-1',open_house_id:'event-1',name:null,phone:'5165550123',phone_normalized:'5165550123'}]);
  const rows=await f.store.saveListingAgents('event-1',{brokerage:'Compass',agents:[agent]});assert.equal(rows[0].brokerage,'Compass');assert.equal(rows[0].email,agent.email);
});
test('repeat enrichment is idempotent',async()=>{
  const f=fixture();await f.store.saveListingAgents('event-1',{brokerage:'Compass',agents:[agent]});const count=f.writes.length;await f.store.saveListingAgents('event-1',{brokerage:'Compass',agents:[agent]});assert.equal(f.writes.length,count);assert.equal(f.tables.listing_agents.length,1);
});
test('failed audit prevents a database write',async()=>{
  let writes=0;const store=createStore({get:async()=>[],post:async()=>{writes++;},patch:async()=>{writes++;},journal:()=>{throw Error('disk full');}});
  await assert.rejects(store.saveListingAgents('event-1',{agents:[agent]}),/disk full/);assert.equal(writes,0);
});
