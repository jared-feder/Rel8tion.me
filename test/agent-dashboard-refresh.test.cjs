const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
require('../apps/rel8tion-app/src/agent-dashboard-refresh.js');
const { create, capture, restore } = global.Rel8tionDashboardRefresh;
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b;}); return {promise,resolve,reject}; };
function rig(load) {
  let visible = true, editing = false, clock = 1000, counter = 0;
  const timers = new Map(), states = [], applied = [];
  const controller = create({load, apply:x=>applied.push(x), onStatus:s=>states.push(s),
    now:()=>clock, isVisible:()=>visible, isEditing:()=>editing,
    setTimer:(fn,delay)=>{timers.set(++counter,{fn,delay});return counter;}, clearTimer:id=>timers.delete(id)});
  return {controller,timers,states,applied,setVisible:v=>visible=v,setEditing:v=>editing=v,
    tick(delay){clock+=delay; const entry=[...timers].find(([,x])=>x.delay===delay); assert.ok(entry,'scheduled '+delay);timers.delete(entry[0]);entry[1].fn();}};
}
test('one read at a time; failed refresh retains last data and timestamp, next read recovers', async()=>{
  const first=deferred();let calls=0;
  const r=rig(()=>{calls++;if(calls===1)return first.promise;if(calls===2)throw Error('network down');return Promise.resolve('new');});
  r.controller.start(); const a=r.controller.refresh(true); const b=r.controller.refresh(true);
  await Promise.resolve();assert.equal(calls,1);first.resolve('old');await Promise.all([a,b]);
  await r.controller.refresh(true);
  assert.deepEqual(r.applied,['old']);assert.equal(r.states.at(-1).phase,'stale');assert.equal(r.states.at(-1).updatedAt,1000);
  await r.controller.refresh(true);assert.deepEqual(r.applied,['old','new']);r.controller.stop();
});
test('hidden and editing pages do not poll; editing begun in flight defers rendering',async()=>{
  let calls=0;const wait=deferred();const r=rig(()=>{calls++;return wait.promise;});r.controller.start();
  r.setVisible(false);await r.controller.refresh(false);assert.equal(calls,0);
  r.setVisible(true);r.setEditing(true);await r.controller.refresh(false);assert.equal(calls,0);
  r.setEditing(false);const result=r.controller.refresh(false);r.setEditing(true);wait.resolve('late');await result;
  assert.deepEqual(r.applied,[]);assert.equal(r.states.at(-1).phase,'paused');r.controller.stop();assert.equal(r.timers.size,0);
});
test('stopped stale response cannot overwrite a newer result even if transport ignores abort',async()=>{
  const old=deferred();let count=0;const r=rig(()=>++count===1?old.promise:Promise.resolve('new'));
  r.controller.start();const pending=r.controller.refresh(true);r.controller.stop();r.controller.start();await r.controller.refresh(true);
  old.resolve('old');await pending;assert.deepEqual(r.applied,['new']);r.controller.stop();
});
test('timeout is bounded and permits manual recovery',async()=>{
  let aborted=false,calls=0;const r=rig(signal=>{signal.addEventListener('abort',()=>aborted=true);return ++calls===1?new Promise(()=>{}):Promise.resolve('recovered');});
  r.controller.start();const pending=r.controller.refresh(true);await Promise.resolve();r.tick(15000);await pending;
  assert.equal(aborted,true);assert.equal(r.states.at(-1).phase,'error');await r.controller.refresh(true);assert.deepEqual(r.applied,['recovered']);r.controller.stop();
});
test('refresh restores unsaved input, checkbox, focus, selection and scroll by check-in identity',()=>{
  const field={name:'purchase_price',value:'712345',checked:false,selectionStart:2,selectionEnd:4};
  const checkbox={name:'apartment_present',value:'on',type:'checkbox',checked:true};
  const form=fields=>({dataset:{checkinId:'a'},querySelectorAll:()=>fields});
  const detail={id:'buyer-details',open:true};
  const container=forms=>({querySelectorAll:selector=>selector==='details'?[detail]:forms});
  const saved=capture(container([form([field,checkbox])]),{activeElement:field},{scrollX:0,scrollY:650});
  let focused=false,selection,scroll;
  const updated={name:field.name,value:'999',focus:()=>focused=true,setSelectionRange:(...x)=>selection=x};
  const check={name:checkbox.name,type:'checkbox',checked:false};
  detail.open=false;
  restore(saved,container([form([updated,check])]),{scrollTo:(...x)=>scroll=x});
  assert.equal(updated.value,'712345');assert.equal(check.checked,true);assert.equal(focused,true);assert.deepEqual(selection,[2,4]);assert.deepEqual(scroll,[0,650]);
  assert.equal(detail.open,true);
});
function page() {
  const elements={};const element=id=>elements[id]||=( {innerHTML:'',textContent:'',addEventListener(){},querySelectorAll(){return [];} } );
  const document={getElementById:element,addEventListener(){},querySelectorAll(){return [];},visibilityState:'visible',activeElement:null};
  const context={URLSearchParams,AbortController,console,Date,navigator:{onLine:true},document,
    Rel8tionDashboardRefresh, setTimeout,clearTimeout,window:{location:{search:'?agent=fixture-agent'},addEventListener(){},scrollX:0,scrollY:0,scrollTo(){}}};
  vm.createContext(context);
  const source=fs.readFileSync(path.join(__dirname,'../apps/rel8tion-app/agent-dashboard.html'),'utf8');
  const inline=[...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]).find(x=>x.includes('const params'));
  vm.runInContext(inline.replace('    refresher.start();\n    refresher.refresh(true);',''),context);
  return {context,elements,run:code=>vm.runInContext(code,context)};
}
test('actual page renders populated and empty no-LO event; explicit help is separate from no preapproval',()=>{
  const p=page();
  p.run(`state.event={id:'event',status:'active'};state.sign={id:'sign'};state.house={address:'Fixture House'};state.checkins=[{id:'a',visitor_name:'Fixture Buyer',pre_approved:false,metadata:{}},{id:'b',visitor_name:'Help Buyer',metadata:{financing_requested:true}}];render();`);
  assert.match(p.elements.app.innerHTML,/Not preapproved · help not requested/);
  assert.match(p.elements.app.innerHTML,/Financing help requested/);
  assert.equal(p.run('eventSummaryStats().financing'),1);assert.doesNotMatch(p.elements.app.innerHTML,/\/admin\?/);
  p.run('state.checkins=[];render()');assert.match(p.elements.app.innerHTML,/No buyer check-ins yet/);
  p.run("renderError('Private access needs verification.')");assert.match(p.elements.app.innerHTML,/Event Pass/);assert.match(p.elements.app.innerHTML,/Retry/);assert.match(p.elements.app.innerHTML,/public buyer QR/);
});
test('actual snapshot read forwards abort signal and rejects wrong host before render',async()=>{
  const p=page();const signal=new AbortController().signal;let received;
  p.context.fetch=async(url,options)=>{received=options.signal;return {ok:true,json:async()=>({event:{id:'x',host_agent_slug:'someone-else'},sign:{id:'s'},checkins:[],outreach:[],membership_active:false})};};
  p.context.testSignal=signal;
  await assert.rejects(p.run('loadSnapshot(testSignal)'),/belongs to someone-else/);assert.equal(received,signal);assert.equal(p.elements.app.innerHTML,'');
});
test('incomplete snapshot is rejected rather than rendering default zero counts as current facts',async()=>{
  const p=page();p.context.fetch=async()=>({ok:true,json:async()=>({event:{id:'x'},sign:{id:'s'}})});
  p.context.testSignal=new AbortController().signal;
  await assert.rejects(p.run('loadSnapshot(testSignal)'),/update was incomplete/);assert.equal(p.elements.app.innerHTML,'');
});
test('root and app deployments can resolve the refresh module without changing private dashboard routes',()=>{
  const root=JSON.parse(fs.readFileSync(path.join(__dirname,'../vercel.json')));
  assert.ok(root.rewrites.some(x=>x.source==='/src/agent-dashboard-refresh.js'&&x.destination==='/apps/rel8tion-app/src/agent-dashboard-refresh.js'));
  assert.ok(fs.existsSync(path.join(__dirname,'../apps/rel8tion-app/src/agent-dashboard-refresh.js')));
});
