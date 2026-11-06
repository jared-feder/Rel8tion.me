const JARED_UID = '38e5ab84-c1a2-4107-9f05-47a6caeda341';
const active = row => !['cancelled','canceled','completed','declined','removed'].includes(String(row.status || '').toLowerCase());
function interval(row) {
  const start = Date.parse(row.scheduled_start || row.open_start || '');
  const end = Date.parse(row.scheduled_end || row.open_end || '');
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? {start,end} : null;
}
function conflicts(bookings, candidate, officer = JARED_UID) {
  const proposed = interval(candidate);
  if (!proposed) return {status:'unverified',rows:[],reason:'Property start and end times must be verified before offering coverage.'};
  const relevant = bookings.filter(b=>active(b) && b.officers.some(p=>p.uid === officer));
  const rows = relevant.filter(booking=>{
    if (booking.queue_row_id && booking.queue_row_id === candidate.queue_row_id) return false;
    const saved = interval(booking);
    return saved && saved.start < proposed.end && proposed.start < saved.end;
  });
  const unknown = relevant.some(b=>!interval(b));
  return {status:rows.length?'conflict':unknown?'unverified':'clear',rows,reason:rows.length?'Jared is already booked during this open house. Offer another officer or a different time.':unknown?'A saved booking has incomplete times. Check the calendar before committing.':'No overlapping Jared assignment found in the loaded schedule. Travel time is not included.'};
}
function checkCalendar(calendar,candidate) {
  if(!calendar?.verified)return {status:'unverified',rows:[],reason:'Calendar is unavailable. Verify bookings before committing.'};
  const proposed=interval(candidate);
  if(proposed&&(proposed.start<Date.parse(calendar.from)||proposed.end>Date.parse(calendar.through)))return {status:'unverified',rows:[],reason:'This open house is outside the loaded calendar range. Verify bookings before committing.'};
  return conflicts(calendar.bookings,candidate,calendar.owner_uid);
}
async function loadCalendar(rest, at = new Date()) {
  const from = new Date(at.getTime()-86400000).toISOString();
  const through = new Date(at.getTime()+60*86400000).toISOString();
  const [scheduled,unscheduled] = await Promise.all([
    rest(`field_demo_visits?select=id,outreach_queue_id,agent_name,scheduled_start,scheduled_end,status&scheduled_start=gte.${encodeURIComponent(from)}&scheduled_start=lt.${encodeURIComponent(through)}&status=not.in.(cancelled,canceled,completed)&order=scheduled_start.asc&limit=1000`),
    rest('field_demo_visits?select=id,outreach_queue_id,agent_name,scheduled_start,scheduled_end,status&scheduled_start=is.null&status=in.(confirmed,scheduled,arrived,live,in_progress)&limit=1000')
  ]);
  if (scheduled.length === 1000||unscheduled.length===1000) throw new Error('Booking limit reached. Calendar completeness is unverified.');
  const visits=[...scheduled,...unscheduled];
  const ids=visits.map(v=>v.id), queues=[...new Set(visits.map(v=>v.outreach_queue_id).filter(Boolean))];
  const [participants,properties]=await Promise.all([
    ids.length?rest(`field_demo_visit_participants?field_demo_visit_id=in.(${ids.map(encodeURIComponent).join(',')})&select=field_demo_visit_id,participant_uid,participant_name,responsibility,is_primary,status&limit=3000`):[],
    queues.length?rest(`agent_outreach_queue?id=in.(${queues.map(encodeURIComponent).join(',')})&select=id,address,city&limit=1000`):[]
  ]);
  if(participants.length===3000)throw new Error('Assignment limit reached. Calendar completeness is unverified.');
  return {verified:true,from,through,timezone:'America/New_York',owner_uid:JARED_UID,loaded_at:at.toISOString(),bookings:visits.filter(active).map(v=>{
    const property=properties.find(p=>p.id===v.outreach_queue_id);
    return {id:v.id,queue_row_id:v.outreach_queue_id,agent_name:v.agent_name,scheduled_start:v.scheduled_start,scheduled_end:v.scheduled_end,status:v.status,address:property?.address||'Property address unavailable',city:property?.city||'',officers:participants.filter(p=>p.field_demo_visit_id===v.id&&p.responsibility==='financing_support'&&active(p)).map(p=>({uid:p.participant_uid,name:p.participant_name,primary:p.is_primary}))};
  })};
}
module.exports={JARED_UID,interval,conflicts,checkCalendar,loadCalendar};
