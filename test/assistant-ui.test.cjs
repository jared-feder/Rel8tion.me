const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {threads,calendar}=require('./fixtures/assistant-workspace.cjs');
test('a failed panel refresh preserves bookings but invalidates every clear conflict result',async()=>{
  const context=vm.createContext({window:{},document:{},queueMicrotask:()=>{},Date,Intl,Map});
  vm.runInContext(fs.readFileSync('apps/rel8tion-app/src/admin-assistant.js','utf8'),context);
  let fail=false;
  const payload={threads:structuredClone(threads),calendar:structuredClone(calendar),actions:[],notifications:[],permissions:['read'],loaded_at:'2026-11-06T16:00:00Z',booking_checks:Object.fromEntries(threads.map(t=>[t.thread_key,{status:'clear',rows:[],reason:'No overlapping Jared assignment found.'}]))};
  const panel=context.window.createAssistantPanel({api:async()=>{if(fail)throw new Error('Read failed');return structuredClone(payload);},esc:String,refresh:()=>{}});
  await panel.load();assert.match(panel.render(),/No overlapping Jared assignment found/);
  fail=true;await panel.load();const html=panel.render();assert.match(html,/400 Booked Court/);assert.match(html,/Calendar status is unverified/);assert.match(html,/Verify the schedule before offering coverage/);assert.doesNotMatch(html,/No overlapping Jared assignment found/);
});
test('automatic assistant refresh respects active editing before fetching',async()=>{
  const html=fs.readFileSync('apps/rel8tion-app/admin.html','utf8');
  const source=html.match(/^    async function refreshLiveData\([^]*?^    \}/m)[0];
  let editing=true,calls=0;
  const context=vm.createContext({state:{verified:true,area:'assistant'},document:{visibilityState:'visible'},isCommandEditing:()=>editing,assistantPanel:{load:async()=>calls++}});
  vm.runInContext(source,context);await context.refreshLiveData();assert.equal(calls,0);editing=false;await context.refreshLiveData();assert.equal(calls,1);
  assert.match(html,/const snapshot = captureUiState\(\);\s*refreshAreaContent\(\);\s*restoreUiState\(snapshot\);/);
});
