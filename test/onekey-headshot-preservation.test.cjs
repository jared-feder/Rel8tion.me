const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
test('headshot persistence only targets rows whose photo is still missing',async()=>{
  const source=fs.readFileSync(path.join(__dirname,'../onekey-headshot-worker.cjs'),'utf8');
  const body=source.slice(source.indexOf('async function persist('),source.indexOf('async function markChecked('));
  const patches=[];
  const sandbox={Buffer,Date,AbortSignal,BUCKET:'photos',config:()=>({url:'https://example.test',key:'test'}),idFilter:ids=>'id=in.('+ids.join(',')+')',patch:async(table,filter,values)=>{patches.push({table,filter,values});return [];},fetch:async()=>({ok:true,headers:{get:()=> 'image/jpeg'},arrayBuffer:async()=>new ArrayBuffer(4000)})};
  vm.createContext(sandbox);vm.runInContext(body,sandbox);
  await sandbox.persist({phone:'5165550123',agentIds:['agent-1'],queueIds:['queue-1']},{imageUrl:'https://example.test/image.jpg',profileUrl:'https://example.test/profile'});
  assert.match(patches[0].filter,/primary_photo_url\.is\.null/);assert.match(patches[0].filter,/directory_photo_url\.is\.null/);assert.match(patches[1].filter,/agent_photo_url\.is\.null/);
});

test('a manual photo saved while enrichment downloads is not replaced or marked missing', async()=>{
  const source=fs.readFileSync(path.join(__dirname,'../onekey-headshot-worker.cjs'),'utf8');
  const body=source.slice(source.indexOf('async function persist('),source.indexOf('async function run('));
  const agent={primary_photo_url:null,directory_photo_url:null,photo_status:null};
  const queue={agent_photo_url:null};
  const sandbox={Buffer,Date,AbortSignal,BUCKET:'photos',config:()=>({url:'https://example.test',key:'test'}),idFilter:()=> 'id=in.(test)',
    fetch:async()=>{agent.primary_photo_url='manual.jpg';agent.photo_status='manual';queue.agent_photo_url='manual.jpg';return {ok:true,headers:{get:()=> 'image/jpeg'},arrayBuffer:async()=>new ArrayBuffer(4000)};},
    patch:async(table,filter,values)=>{
      const row=table==='listing_agents'?agent:queue;
      const guarded=table==='listing_agents'?filter.includes('and=(or(primary_photo_url.is.null,primary_photo_url.eq.),or(directory_photo_url.is.null,directory_photo_url.eq.))'):filter.includes('or=(agent_photo_url.is.null,agent_photo_url.eq.)');
      const alreadyFilled=table==='listing_agents'?Boolean(agent.primary_photo_url||agent.directory_photo_url):Boolean(queue.agent_photo_url);
      if(guarded&&alreadyFilled)return [];
      Object.assign(row,values);return [row];
    }};
  vm.createContext(sandbox);vm.runInContext(body,sandbox);
  const target={phone:'5165550123',agentIds:['agent-1'],queueIds:['queue-1']};
  await sandbox.persist(target,{imageUrl:'https://example.test/image.jpg',profileUrl:'https://example.test/profile'});
  await sandbox.markChecked(target,'not_found');
  assert.equal(agent.primary_photo_url,'manual.jpg');assert.equal(agent.photo_status,'manual');assert.equal(queue.agent_photo_url,'manual.jpg');
});
