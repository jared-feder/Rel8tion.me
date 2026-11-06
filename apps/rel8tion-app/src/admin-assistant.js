/* COMMAND's assistant workspace. All writes use the protected server API. */
window.createAssistantPanel = function ({api, esc, refresh}) {
  let data = null, error = '', loading = false, selected = '', filter = 'all', search = '', busy = false;
  const drafts = new Map();
  let pushConfig=null, sendReview=null;
  let ownerToken = '', pushStatus = 'Push requires server setup and permission on this device.';
  try { selected=new URL(window.location.href).searchParams.get('thread')||''; } catch {}
  const requestApi=(path,options={})=>api(path,{...options,headers:{...(options.headers||{}),...(ownerToken?{'x-admin-token':ownerToken}:{})}});
  async function connectOwner(){
    const input=document.getElementById('assistant-owner-token'),candidate=input?.value||'';
    if(!candidate)return;input.value='';
    try{
      const next=await api('/api/admin/assistant',{headers:{'x-admin-token':candidate}});
      if(!next.permissions?.includes('approve'))throw new Error('Owner authentication was not verified.');
      ownerToken=candidate;data=next;error='';
      const config=await requestApi('/api/admin/assistant-push');
      pushStatus=config.configured?'Push is configured. Enable it on this device.':'Push requires its separately approved server key.';
    }catch(e){error=e.message;}refresh();
  }
  async function configurePush(disable=false){
    if(busy)return;busy=true;error='';
    try{
      if(!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window))throw new Error('Web Push is unavailable in this browser. On iPhone, use the installed Home Screen app.');
      const config=await requestApi('/api/admin/assistant-push');
      if(!disable&&!config.configured)throw new Error('Push requires its separately approved server key.');
      if(!disable&&await Notification.requestPermission()!=='granted')throw new Error('Push permission was not granted.');
      const registration=disable?await navigator.serviceWorker.getRegistration('/command'):await navigator.serviceWorker.register('/assistant-sw.js',{scope:'/command'});
      if(!registration)throw new Error('No assistant push registration exists on this device.');
      if(!disable&&!registration.active)await new Promise((resolve,reject)=>{
        const worker=registration.installing||registration.waiting;
        if(!worker)return reject(new Error('Push worker is not ready. Try again.'));
        const timeout=setTimeout(()=>reject(new Error('Push worker activation timed out. Try again.')),10000);
        worker.addEventListener('statechange',()=>{if(worker.state==='activated'){clearTimeout(timeout);resolve();}});
      });
      let subscription=await registration.pushManager.getSubscription();
      if(!disable&&!subscription){const base=config.public_key.replace(/-/g,'+').replace(/_/g,'/');subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:Uint8Array.from(atob(base),c=>c.charCodeAt(0))});}
      if(subscription){await requestApi('/api/admin/assistant-push',{method:'POST',body:JSON.stringify({action:disable?'disable':'subscribe',subscription:subscription.toJSON()})});if(disable)await subscription.unsubscribe();}
      pushStatus=disable?'Push is disabled on this device.':'Push is enabled on this device. Display and sound depend on device settings.';
    }catch(e){error=e.message;}finally{busy=false;refresh();}
  }
  let request = null;
  let calendarDay = '', calendarOfficer = 'mine';
  const label = {pending_approval:'Needs Jared',approved:'Approved reply',simulated:'Simulated only',dismissed:'Dismissed',dispatching:'Submission in progress - do not resend',accepted:'Provider accepted',delivered:'Provider reports delivered',failed:'Failed - review receipt',blocked:'Blocked',unknown:'Outcome unverified - do not resend'};
  const date = value => value ? new Date(value).toLocaleString('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}) : '';
  const dayKey = value => new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
  const inbound = thread => [...(thread.messages||[])].filter(m=>m.direction==='inbound').sort((a,b)=>new Date(b.received_at||b.created_at)-new Date(a.received_at||a.created_at))[0];
  function current(){return data?.threads.find(t=>t.thread_key===selected);}
  async function load(){
    if(loading)return; loading=true; error=''; refresh();
    try { const next=await requestApi('/api/admin/assistant');if(!next.calendar?.verified&&data?.calendar?.bookings?.length)next.calendar={...data.calendar,verified:false,error:next.calendar?.error||'Calendar refresh failed.'};data=next;if(data.permissions?.includes('push')){try{pushConfig=await requestApi('/api/admin/assistant-push');pushStatus=pushConfig.configured?'Push is configured. Enable it on this device.':'Push requires its separately approved server key.';}catch{pushConfig=null;pushStatus='Push setup could not be verified.';}}calendarDay=calendarDay||dayKey(data.loaded_at);if(!current())selected=data.threads[0]?.thread_key||''; }
    catch(e){
      error=e.message;
      if(data){
        data.calendar={...(data.calendar||{}),verified:false,error:'Calendar refresh failed. Saved bookings are shown as unverified.'};
        data.booking_checks=Object.fromEntries((data.threads||[]).map(t=>[t.thread_key,{status:'unverified',rows:[],reason:'Calendar refresh failed. Verify the schedule before offering coverage.'}]));
      }
    } finally{loading=false;refresh();}
  }
  function visible(){return (data?.threads||[]).filter(t=>{
    const actions=data.actions.filter(a=>a.thread_key===t.thread_key);
    const match=filter==='all'||filter==='incoming'&&!!inbound(t)||filter==='sent'&&(actions.some(a=>a.status==='simulated')||(t.messages||[]).some(m=>m.assistant_author))||filter==='review'&&actions.some(a=>a.status==='pending_approval');
    return match&&[t.agent_name,t.address,t.city,inbound(t)?.body].join(' ').toLowerCase().includes(search.toLowerCase());
  });}
  function renderCalendar(){
    const calendar=data?.calendar, rows=(calendar?.bookings||[]).filter(b=>calendarOfficer==='all'||b.officers.some(o=>o.uid===calendar.owner_uid));
    const first=new Date(`${calendarDay||dayKey(data?.loaded_at||new Date())}T12:00:00Z`);
    const days=Array.from({length:7},(_,i)=>{const d=new Date(first);d.setUTCDate(d.getUTCDate()+i);return dayKey(d);});
    const selectedCheck=data?.booking_checks?.[selected];
    return `<section class="assistant-calendar" aria-label="Booked open houses"><div class="section-head"><div><h3>Booked open houses</h3><p class="small">America/New_York · Saved assignments · Travel time is not included.</p></div><div class="assistant-tabs"><button class="btn soft" data-calendar-move="-7" aria-label="Previous week">Previous</button><button class="btn soft" data-calendar-today>Today</button><button class="btn soft" data-calendar-move="7" aria-label="Next week">Next</button></div></div><div class="assistant-tabs"><label class="small" for="assistant-calendar-officer">Coverage</label><select id="assistant-calendar-officer" class="input"><option value="mine" ${calendarOfficer==='mine'?'selected':''}>Jared's bookings</option><option value="all" ${calendarOfficer==='all'?'selected':''}>All loan officers</option></select><label class="small" for="assistant-calendar-day">Week starting</label><input type="date" id="assistant-calendar-day" class="input" value="${esc(calendarDay)}"></div>
      ${!calendar?.verified?`<p class="error" role="alert">${esc(calendar?.error||'Calendar is loading.')} Calendar status is unverified; do not assume a time is free.</p>`:''}
      <div class="assistant-calendar-days">${days.map(day=>`<div class="assistant-calendar-day"><strong>${esc(new Date(day+'T12:00:00Z').toLocaleDateString('en-US',{timeZone:'America/New_York',weekday:'short',month:'short',day:'numeric'}))}</strong>${rows.filter(b=>b.scheduled_start&&dayKey(b.scheduled_start)===day).map(b=>`<article class="assistant-booking"><b>${esc(date(b.scheduled_start))} – ${esc(date(b.scheduled_end))}</b><span>${esc(b.address)}</span><span>${esc(b.agent_name)}</span><small>${esc(b.officers.map(o=>o.name).join(', ')||'Officer unassigned')} · ${esc(b.status)}</small><a href="/command?area=events&event=${encodeURIComponent(b.id)}">View booking</a></article>`).join('')||'<p class="small">No loaded bookings</p>'}</div>`).join('')}</div>
      ${selectedCheck?`<div class="assistant-conflict ${selectedCheck.status}" role="status"><strong>${selectedCheck.status==='conflict'?'Scheduling conflict':selectedCheck.status==='clear'?'Calendar checked':'Confirm timing'}</strong><p>${esc(selectedCheck.reason)}</p>${selectedCheck.rows.map(b=>`<p>${esc(b.address)} · ${esc(date(b.scheduled_start))} – ${esc(date(b.scheduled_end))}</p>`).join('')}</div>`:''}<p class="small">Loaded schedule: ${esc(date(calendar?.from))} through ${esc(date(calendar?.through))}. ${calendar?.verified?'Last checked '+esc(date(calendar.loaded_at)):''}</p></section>`;
  }
  function render(){
    if(!data&&!loading&&!error)queueMicrotask(load);
    const thread=current(), last=thread&&inbound(thread), actions=data?.actions.filter(a=>a.thread_key===selected)||[];
    const pending=data?.actions.filter(a=>a.status==='pending_approval')||[];
    const bookingCheck=data?.booking_checks?.[selected];
    const tasks=(data?.threads||[]).filter(t=>inbound(t)&&!t.any_opt_out&&!t.latest_reply_opt_out&&!/opted_out|confirmed|accepted|not_now/.test(t.review_status||'')&&!data.actions.some(a=>a.thread_key===t.thread_key&&a.in_reply_to===inbound(t)?.id&&['pending_approval','approved','simulated'].includes(a.status)));
    return `<section class="assistant-workspace" aria-label="Jared's Assistant">
      <div class="section-head"><div><div class="mini-title">CAT / REL8TION</div><h2>Jared's Assistant</h2><div class="sub">Conversations, decisions and the work waiting for us.</div></div><button class="btn soft" data-assistant-refresh ${loading?'disabled':''}>${loading?'Refreshing...':'Refresh inbox'}</button></div>
      <div class="assistant-banner"><strong>${data?.mode==='live_context'?'Live inbox and bookings':'Simulation workspace'}</strong><span>${data?.mode!=='live_context'?'Mock workspace; no real texts.':data?.sending_ready?'Approved manual replies are connected.':'Manual replies await server enablement.'} REL8TION sender: 844-821-1802.</span><span>${esc(pushStatus)} No SMS fallback.</span></div>
      ${!data?.permissions?.includes('approve')?`<div class="assistant-tabs"><label for="assistant-owner-token">Owner connection</label><input type="password" class="input" id="assistant-owner-token" autocomplete="off" placeholder="Existing owner token"><button class="btn soft" data-owner-connect>Connect for this page session</button><span class="small">The token stays in memory until this page reloads.</span></div>`:`<div class="assistant-tabs"><button class="btn soft" data-push-enable>Enable push on this device</button><button class="btn soft" data-push-disable>Disable device push</button></div>`}
      ${sendReview?`<div class="assistant-pane" role="region" aria-label="Confirm approved reply"><h3>Send this approved reply?</h3><p>From REL8TION 844-821-1802 to ${esc(sendReview.recipient_phone)}</p><p>${esc(sendReview.body)}</p><button class="btn primary" data-confirm-send ${busy?'disabled':''}>Confirm send</button><button class="btn soft" data-cancel-send ${busy?'disabled':''}>Cancel</button></div>`:''}
      ${error?`<div class="error" role="alert">${esc(error)} ${data?'Last successful snapshot retained; current status unverified.':''}</div>`:''}
      <div class="assistant-metrics"><div><strong>${data?.threads.length||0}</strong><span>Conversations</span></div><div><strong>${tasks.length}</strong><span>For Cat</span></div><div><strong>${pending.length}</strong><span>Awaiting Jared</span></div><div><strong>${data?.actions.filter(a=>a.status==='simulated').length||0}</strong><span>Simulated replies</span></div></div>
      ${renderCalendar()}
      <div class="assistant-columns">
        <aside class="assistant-pane"><h3>Inbox</h3><label class="small" for="assistant-search">Search contact or property</label><input class="input" id="assistant-search" value="${esc(search)}" placeholder="Name, address or message"><div class="assistant-tabs">${[['all','All'],['incoming','Incoming'],['sent','Assistant sent'],['review','Needs Jared']].map(([key,name])=>`<button class="btn ${filter===key?'primary':'soft'}" data-assistant-filter="${key}" aria-pressed="${filter===key}">${name}</button>`).join('')}</div>
        <div class="assistant-thread-list">${visible().map(t=>`<button class="assistant-thread ${selected===t.thread_key?'selected':''}" data-assistant-thread="${esc(t.thread_key)}"><strong>${esc(t.agent_name||'Unlinked contact')}</strong><span>${esc(t.address||'No linked property')}</span><p>${esc(inbound(t)?.body||'No incoming reply')}</p><small>${esc(t.any_opt_out?'Opted out':t.review_status||'Needs review')}</small></button>`).join('')||'<p class="small">No matching conversations.</p>'}</div></aside>
        <section class="assistant-pane assistant-conversation" aria-label="Conversation">${thread?`
          <div class="assistant-contact"><div class="mini-title">${esc(thread.brokerage||'Business contact')}</div><h3>${esc(thread.agent_name||'Unlinked contact')}</h3><div class="small">${esc(thread.agent_phone||'Phone unverified')}<br>${esc([thread.address,thread.city].filter(Boolean).join(', '))}<br>${esc(date(thread.open_start))}</div><a class="btn soft" href="/command?area=outreach&q=${encodeURIComponent(thread.agent_name||'')}">Open outreach workflow</a></div>
          <div class="assistant-messages">${[...(thread.messages||[])].sort((a,b)=>new Date(a.received_at||a.created_at)-new Date(b.received_at||b.created_at)).map(m=>`<article class="assistant-message ${m.direction==='outbound'?'outgoing':''}"><small>${m.assistant_author?esc(m.assistant_identity||'Cat from REL8TION'):m.direction==='outbound'?'REL8TION / existing message':esc(thread.agent_name||'Incoming')} · ${esc(date(m.received_at||m.created_at))}</small><p>${esc(m.body)}</p><small>${m.assistant_author?'Provider status: '+esc(m.provider_status||'unknown'):m.direction==='outbound'?'Historical record; assistant authorship unverified':'Incoming'} · ${esc(m.message_sid||m.id)}</small></article>`).join('')}
          ${actions.map(a=>`<article class="assistant-message outgoing"><small>${esc(a.identity)} · ${esc(label[a.status]||a.status)}</small><p>${esc(a.body)}</p><small>From ${esc(a.sender)} · author ${esc(a.author)} · reply to ${esc(a.in_reply_to)}</small><details><summary>Audit trail</summary>${a.audit.map(e=>`<p class="small">${esc(e.event)} / ${esc(e.actor)} / ${esc(date(e.at))}</p>`).join('')}</details><div class="assistant-tabs">${a.status==='pending_approval'?`<button class="btn primary" data-assistant-action="approve" data-id="${esc(a.id)}" ${!data?.permissions?.includes('approve')?'disabled':''}>Approve reply</button>`:''}${a.status==='approved'&&data?.sending_ready&&data?.permissions?.includes('send')?`<button class="btn primary" data-assistant-action="send" data-id="${esc(a.id)}">Send approved reply</button>`:''}${a.status==='approved'?`<button class="btn primary" data-assistant-action="simulate" data-id="${esc(a.id)}">Simulate reply</button>`:''}${['pending_approval','approved'].includes(a.status)?`<button class="btn soft" data-assistant-action="dismiss" data-id="${esc(a.id)}">Dismiss</button>`:''}</div></article>`).join('')}</div>
          <form id="assistant-compose">${bookingCheck?`<div class="assistant-conflict ${bookingCheck.status}" role="status"><strong>${bookingCheck.status==='conflict'?'Jared is already booked':bookingCheck.status==='clear'?'No Jared overlap found':'Verify coverage time'}</strong><p>${esc(bookingCheck.reason)}</p>${bookingCheck.rows.map(b=>`<p>${esc(b.address)} · ${esc(date(b.scheduled_start))} – ${esc(date(b.scheduled_end))}</p>`).join('')}</div>`:''}<label for="assistant-draft"><strong>Draft a reply as Cat</strong></label><p class="small">Introduction added: “This is Cat from REL8TION, Jared's assistant.”</p><textarea class="input" id="assistant-draft" rows="4" maxlength="1200" placeholder="Write a reply for Jared to review" ${busy||thread.any_opt_out||thread.latest_reply_opt_out?'disabled':''}>${esc(drafts.get(selected)||'')}</textarea><p class="small">${last?`Replying to ${esc(last.id)}. Latest message, contact, opt-out and sending hours are checked again before sending.`:'No incoming message to reply to.'}</p><button class="btn primary" ${busy||!last||!data?.permissions?.includes('draft')||thread.any_opt_out||thread.latest_reply_opt_out?'disabled':''}>${busy?'Saving...':!data?.permissions?.includes('draft')?'Owner token required to save':'Save for Jared’s review'}</button><p class="small" role="status">${esc(data?.loaded_at?'Snapshot '+date(data.loaded_at):'Loading snapshot...')}</p></form>`:'<h3>Select a conversation</h3><p>Incoming replies and assistant work will appear here.</p>'}</section>
        <aside class="assistant-pane"><h3>Jared's upcoming bookings</h3>${(data?.calendar?.bookings||[]).filter(b=>b.officers.some(o=>o.uid===data.calendar.owner_uid)).slice(0,5).map(b=>`<article class="assistant-booking"><b>${esc(date(b.scheduled_start))} – ${esc(date(b.scheduled_end))}</b><span>${esc(b.address)}</span><small>${esc(b.agent_name)}</small></article>`).join('')||'<p class="small">No Jared assignments in the loaded schedule. Check calendar status before committing.</p>'}<h3>Work queue</h3><div class="mini-title">AWAITING JARED</div>${pending.map(a=>`<button class="assistant-task" data-assistant-thread="${esc(a.thread_key)}"><strong>Review Cat's reply</strong><span>${esc(data.threads.find(t=>t.thread_key===a.thread_key)?.agent_name||a.thread_key)}</span></button>`).join('')||'<p class="small">No approvals waiting.</p>'}<div class="mini-title">FOR CAT</div>${tasks.map(t=>`<button class="assistant-task" data-assistant-thread="${esc(t.thread_key)}"><strong>Review incoming reply</strong><span>${esc(t.agent_name||'Unlinked contact')}</span></button>`).join('')||'<p class="small">Nothing waiting for Cat.</p>'}<div class="mini-title">WAITING ON CONTACT</div>${(data?.threads||[]).filter(t=>t.review_status==='awaiting_reply').map(t=>`<button class="assistant-task" data-assistant-thread="${esc(t.thread_key)}"><strong>Awaiting reply</strong><span>${esc(t.agent_name)}</span></button>`).join('')||'<p class="small">No outstanding direct replies.</p>'}
        <h3>Review notifications</h3><p class="small">Important decisions, callback requests and booking changes; routine replies stay in the inbox. Device push requires owner connection and permission.</p>${(data?.notifications||[]).map(n=>`<button class="assistant-task" data-assistant-thread="${esc(n.thread_key)}"><strong>${esc(n.title)}</strong><span>${esc(n.body)}</span><small>Review item · ${esc(n.id)}</small></button>`).join('')||'<p class="small">No important replies requiring review.</p>'}<p class="small">Sending requires approval of the exact saved reply. Unverified submissions must be reviewed before any further message. Push never falls back to paid owner SMS.</p></aside>
      </div></section>`;
  }
  async function act(input){if(busy)return;busy=true;error='';refresh();try{await requestApi('/api/admin/assistant',{method:'POST',body:JSON.stringify(input)});if(input.action==='send')sendReview=null;if(input.action==='draft'){drafts.delete(input.thread_key);request=null;}await load();}catch(e){error=e.message;}finally{busy=false;refresh();}}
  function bind(){
    document.querySelector('[data-confirm-send]')?.addEventListener('click',()=>{if(sendReview)act({action:'send',id:sendReview.id,fingerprint:sendReview.fingerprint});});
    document.querySelector('[data-cancel-send]')?.addEventListener('click',()=>{sendReview=null;refresh();});
    document.querySelector('[data-owner-connect]')?.addEventListener('click',connectOwner);
    document.querySelector('[data-push-enable]')?.addEventListener('click',()=>configurePush(false));
    document.querySelector('[data-push-disable]')?.addEventListener('click',()=>configurePush(true));
    document.querySelectorAll('[data-calendar-move]').forEach(b=>b.addEventListener('click',()=>{const d=new Date(calendarDay+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+Number(b.dataset.calendarMove));calendarDay=dayKey(d);refresh();}));
    document.querySelector('[data-calendar-today]')?.addEventListener('click',()=>{calendarDay=dayKey(data?.loaded_at||new Date());refresh();});
    document.getElementById('assistant-calendar-day')?.addEventListener('change',e=>{if(/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)){calendarDay=e.target.value;refresh();}});
    document.getElementById('assistant-calendar-officer')?.addEventListener('change',e=>{calendarOfficer=e.target.value;refresh();});
    document.querySelector('[data-assistant-refresh]')?.addEventListener('click',load);
    document.querySelectorAll('[data-assistant-thread]').forEach(b=>b.addEventListener('click',()=>{selected=b.dataset.assistantThread;request=null;refresh();}));
    document.querySelectorAll('[data-assistant-filter]').forEach(b=>b.addEventListener('click',()=>{filter=b.dataset.assistantFilter;refresh();}));
    document.getElementById('assistant-search')?.addEventListener('change',e=>{search=e.target.value;refresh();});
    document.getElementById('assistant-draft')?.addEventListener('input',e=>{drafts.set(selected,e.target.value);request=null;});
    document.getElementById('assistant-compose')?.addEventListener('submit',e=>{e.preventDefault();const t=current(),m=inbound(t);if(!m)return;request=request||{request_id:crypto.randomUUID(),thread_key:selected,in_reply_to:m.id,body:drafts.get(selected)||'',action:'draft'};act(request);});
    document.querySelectorAll('[data-assistant-action]').forEach(b=>{b.disabled=busy;b.addEventListener('click',()=>{const action=b.dataset.assistantAction,record=data.actions.find(a=>a.id===b.dataset.id);if(action==='send'){sendReview={id:record.id,fingerprint:record.fingerprint,body:record.body,recipient_phone:record.recipient_phone};refresh();return;}act({action,id:b.dataset.id,...(action==='send'?{fingerprint:record?.fingerprint}:{})});});});
  }
  return {render,bind,load};
};
