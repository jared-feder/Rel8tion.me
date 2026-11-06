const threads = [
  {thread_key:'sample-avery',queue_row_id:'sample-queue-avery',agent_name:'Avery Demo',agent_phone:'+12025550101',brokerage:'Sample Realty',address:'100 Example Lane',city:'Demo City',open_start:'2026-11-07T16:00:00Z',open_end:'2026-11-07T17:30:00Z',review_status:'needs_reply',messages:[
    {id:'sample-out-1',direction:'outbound',body:'Would you like open-house coverage this Saturday?',received_at:'2026-11-06T14:00:00Z'},
    {id:'sample-in-1',message_sid:'SIMULATED-IN-1',direction:'inbound',from_phone:'+12025550101',to_phone:'+18448211802',body:'Yes, I am available. Can you confirm the time?',received_at:'2026-11-06T15:00:00Z'}]},
  {thread_key:'sample-morgan',queue_row_id:'sample-queue-morgan',agent_name:'Morgan Sample',agent_phone:'+12025550102',brokerage:'Example Brokerage',address:'200 Sample Avenue',city:'Demo City',review_status:'needs_reply',messages:[{id:'sample-in-2',direction:'inbound',to_phone:'+18448211802',body:'Please call me about the schedule change.',received_at:'2026-11-06T14:30:00Z'}]},
  {thread_key:'sample-riley',queue_row_id:'sample-queue-riley',agent_name:'Riley Example',agent_phone:'+12025550103',address:'300 Test Road',city:'Demo City',review_status:'opted_out',any_opt_out:true,messages:[{id:'sample-in-3',direction:'inbound',to_phone:'+18448211802',body:'STOP',opt_out:true,received_at:'2026-11-06T13:00:00Z'}]}
];
function memoryStore(seed=[]){
  const records=new Map(seed.map(a=>[a.id,structuredClone(a)]));
  return {list:async()=>structuredClone([...records.values()]),get:async id=>structuredClone(records.get(id)),insert:async record=>{
    const old=records.get(record.id);if(old){if(old.fingerprint!==record.fingerprint)throw Object.assign(new Error('Conflicting request id.'),{status:409});return structuredClone(old);}
    records.set(record.id,structuredClone(record));return structuredClone(record);
  },transition:async(record,status,event,patch={})=>{const old=records.get(record.id);if(old.status!==record.status)throw Object.assign(new Error('Concurrent transition.'),{status:409});const next={...old,...patch,status,audit:[...old.audit,event]};records.set(next.id,next);return structuredClone(next);}};
}
const calendar={verified:true,from:'2026-11-05T16:00:00Z',through:'2027-01-05T16:00:00Z',loaded_at:'2026-11-06T16:00:00Z',timezone:'America/New_York',owner_uid:'38e5ab84-c1a2-4107-9f05-47a6caeda341',bookings:[
  {id:'sample-booked-jared',queue_row_id:'other-sample-queue',agent_name:'Casey Example',address:'400 Booked Court',status:'confirmed',scheduled_start:'2026-11-07T16:00:00Z',scheduled_end:'2026-11-07T18:00:00Z',officers:[{uid:'38e5ab84-c1a2-4107-9f05-47a6caeda341',name:'Jared Feder'}]},
  {id:'sample-booked-laura',queue_row_id:'sample-queue-laura',agent_name:'Taylor Sample',address:'500 Demo Court',status:'confirmed',scheduled_start:'2026-11-07T17:00:00Z',scheduled_end:'2026-11-07T19:00:00Z',officers:[{uid:'sample-laura',name:'Laura (sample)'}]}
]};
module.exports={threads,memoryStore,calendar};
