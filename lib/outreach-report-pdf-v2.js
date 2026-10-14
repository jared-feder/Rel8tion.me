const { number: n, percent: pct, change } = require('./outreach-report-pdf-v1');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const clean = v => String(v ?? '').normalize('NFKD').replace(/[^\x20-\x7E\n]/g, '').trim();
const avg = v => v == null ? 'N/A' : n(v);
const counted = (value, singular, plural = `${singular}s`) => `${n(value)} ${value === 1 ? singular : plural}`;
function emailHtml(s) {
  const w=s.current,b=s.leads.current;
  return `<div style="font-family:Inter,'Segoe UI',Arial,sans-serif;max-width:680px;margin:auto;color:#17224f;border-top:5px solid #38bdf8"><div style="padding:18px 28px;background:#fff"><img src="https://rel8tion.me/wp-content/uploads/2026/04/logo150x100trans.png" width="150" height="60" alt="REL8TION" style="display:block"><p style="margin:0;color:#1f2a5a;font-size:12px;letter-spacing:2px;font-weight:bold">COMMAND / WEEKLY PERFORMANCE</p></div><div style="background:#1f2a5a;color:white;padding:28px"><p style="color:#38bdf8">OUTREACH PERFORMANCE BRIEF</p><h1 style="font-family:'Plus Jakarta Sans',Inter,Arial,sans-serif">Relationships. Open houses. Results.</h1><p>Week of ${s.week}</p></div><div style="padding:28px;background:#f0f7ff"><h2>From conversations to open houses</h2><p>${counted(w.replied,'agent')} replied to this week's outreach cohort. ${counted(w.replyingHosts,'agent')} became a confirmed host (${pct(w.replyToHostRate)}), accounting for ${counted(w.confirmedFromReplies,'open house')}.</p><h2>${counted(b.totalLeadRecords,'lead record')} this week</h2><p>${counted(b.buyerLeads,'buyer check-in')} and ${counted(b.profileLeads,'profile / HomeKey lead')}. ${counted(b.producingOpenHouses,'event')} produced leads, averaging ${avg(b.leadsPerProducingOpenHouse)} each.</p><p>The attached PDF includes the full funnel, weekly comparisons, leads by property, relationship network and data-engine charts.</p><p><a href="https://app.rel8tion.me/command?area=reports" style="display:inline-block;background:#2563eb;color:white;padding:14px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Open your report archive</a></p><p style="font-size:12px;color:#64748b">Outcomes reflect evidence available at generation. Lead records are not unique buyers or proof of outreach attribution.</p><p style="font-size:12px;color:#1f2a5a"><strong>REL8TION COMMAND</strong> &nbsp; / &nbsp; <a href="https://rel8tion.me" style="color:#2563eb">rel8tion.me</a></p></div></div>`;
}
async function renderPdf(s) {
  const { PDFDocument, rgb } = require('pdf-lib');
  const pdf=await PDFDocument.create();
  pdf.setTitle(`REL8TION Outreach Performance Brief - ${s.week} - Expanded edition`);pdf.setAuthor('REL8TION');
  pdf.setCreationDate(new Date(s.generatedAt));pdf.setModificationDate(new Date(s.generatedAt));
  pdf.registerFontkit(require('@pdf-lib/fontkit'));
  // Full Inter embedding preserves composite glyphs that the PDF subsetter drops.
  const regular=await pdf.embedFont(readFileSync(path.join(__dirname,'../assets/rel8tion-brand/Inter-Regular.ttf')));
  const bold=await pdf.embedFont(readFileSync(path.join(__dirname,'../assets/rel8tion-brand/Inter-Bold.ttf')));
  const display=await pdf.embedFont(readFileSync(path.join(__dirname,'../assets/rel8tion-brand/PlusJakartaSans-ExtraBold.ttf')),{subset:true});
  const logo=await pdf.embedPng(readFileSync(path.join(__dirname,'../assets/rel8tion-brand/rel8tion-logo.png')));
  const hex=value=>rgb(...value.match(/\w\w/g).map(v=>parseInt(v,16)/255));
  const c={navy:hex('1f2a5a'),cyan:hex('38bdf8'),blue:hex('2563eb'),pale:hex('f0f7ff'),muted:hex('64748b'),line:hex('d8e7f5'),white:rgb(1,1,1)};
  const fontFor=(size,strong)=>strong?(size>=14?display:bold):regular;
  let page,y,title,subtitle;
  const box=(x,t,w,h,color)=>page.drawRectangle({x,y:792-t-h,width:w,height:h,color});
  const text=(v,x,t,size=10,strong=false,color=c.navy)=>page.drawText(clean(v),{x,y:792-t-size,size,font:fontFor(size,strong),color});
  const line=(x,t,x2,t2)=>page.drawLine({start:{x,y:792-t},end:{x:x2,y:792-t2},color:c.line,thickness:1});
  function wrap(v,width,size=10,strong=false){
    const font=fontFor(size,strong),rows=[];
    for(const para of clean(v).split('\n')){let row='';for(const word of para.split(/\s+/)){
      if(row && font.widthOfTextAtSize(`${row} ${word}`,size)>width){rows.push(row);row='';}
      let rest=word;while(font.widthOfTextAtSize(rest,size)>width){if(row){rows.push(row);row='';}let cut=rest.length-1;while(cut>1&&font.widthOfTextAtSize(rest.slice(0,cut),size)>width)cut--;rows.push(rest.slice(0,cut));rest=rest.slice(cut);}
      row=row?`${row} ${rest}`:rest;}rows.push(row);}return rows;
  }
  function start(t,sub){title=t;subtitle=sub;page=pdf.addPage([612,792]);box(0,0,204,4,c.cyan);box(204,0,204,4,c.blue);box(408,0,204,4,c.navy);page.drawImage(logo,{x:28,y:792-10-44,width:110,height:44});text('COMMAND',149,24,13,true);text('WEEKLY PERFORMANCE',431,28,8,true,c.blue);line(40,59,572,59);text(t,40,76,25,true);wrap(sub,532,9).forEach((v,i)=>text(v,40,116+i*13,9,false,c.muted));y=150;}
  function space(h){if(y+h>731)start(`${title.replace(' (continued)','')} (continued)`,subtitle);}
  function para(v,size=10,color=c.muted,gap=12){const rows=wrap(v,532,size);space(rows.length*size*1.5+gap);rows.forEach(v=>{text(v,40,y,size,false,color);y+=size*1.5;});y+=gap;}
  function heading(v){space(33);text(v,40,y,14,true);y+=29;}
  function cards(items){space(101);const width=(532-(items.length-1)*10)/items.length;items.forEach(([label,value,detail],i)=>{const x=40+i*(width+10);box(x,y,width,87,c.pale);box(x,y,3,87,i===items.length-1?c.blue:c.cyan);let size=25;while(display.widthOfTextAtSize(clean(value),size)>width-24)size--;text(value,x+12,y+9,size,true);wrap(label,width-24,9,true).forEach((v,j)=>text(v,x+12,y+43+j*11,9,true));if(detail)wrap(detail,width-24,8).slice(0,2).forEach((v,j)=>text(v,x+12,y+65+j*9,8,false,c.muted));});y+=105;}
  function table(headers,rows,widths,size=9){
    const header=()=>{space(28);box(40,y,532,26,c.navy);let x=40;headers.forEach((h,i)=>{text(h,x+8,y+8,size,true,c.white);x+=widths[i];});y+=26;};header();
    rows.forEach((row,index)=>{const cells=row.map((v,i)=>wrap(v,widths[i]-16,size));const h=Math.max(28,Math.max(...cells.map(v=>v.length))*(size+4)+12);if(y+h>731){start(`${title.replace(' (continued)','')} (continued)`,subtitle);header();}if(index%2===0)box(40,y,532,h,c.pale);let x=40;cells.forEach((v,i)=>{v.forEach((t,j)=>text(t,x+8,y+7+j*(size+4),size));x+=widths[i];});y+=h;});y+=16;
  }
  function bars(rows,labelWidth=165,width=295){const max=Math.max(1,...rows.map(r=>r[1]));for(const [label,value] of rows){const labels=wrap(label,labelWidth-10,9),h=Math.max(24,labels.length*12+6);space(h);labels.forEach((v,j)=>text(v,40,y+2+j*12,9));box(40+labelWidth,y,width,16,c.pale);box(40+labelWidth,y,width*value/max,16,c.cyan);text(n(value),50+labelWidth+width,y+2,9,true);y+=h;}y+=8;}
  function trend(rows,field,label,color=c.cyan,top=y,x=40,width=532,height=112){text(label,x,top,10,true);const chartTop=top+30,chartH=height-50,max=Math.max(1,...rows.map(r=>r[field]));line(x,chartTop+chartH,x+width,chartTop+chartH);const step=width/Math.max(1,rows.length);rows.forEach((r,i)=>{const h=chartH*r[field]/max,bx=x+i*step+step*.22;box(bx,chartTop+chartH-h,step*.56,h,color);text(n(r[field]),bx,chartTop+chartH-h-14,8,true);text(r.week.slice(5),bx,chartTop+chartH+6,8,false,c.muted);});}
  const l=s.lifetime,w=s.current,p=s.prior,e=s.engine,b=s.leads.current,bp=s.leads.prior;
  const pp=(a,z)=>a==null||z==null?'N/A':`${a>=z?'+':''}${((a-z)*100).toFixed(1)} pp`;
  start('Outreach performance brief',`WEEK OF ${s.week} / PREPARED FOR REL8TION COMMAND`);
  box(40,145,532,145,c.navy);box(40,145,5,145,c.cyan);text('Conversations that become',60,165,25,true,c.white);text('open houses. Leads that follow.',60,198,25,true,c.white);text('A weekly view of reach, conversion and buyer activity.',60,252,11,false,c.white);y=309;
  cards([['Outbound messages',n(l.outbound)],['Confirmed houses',n(l.confirmed)],['Active relationships',n(s.relationships.active)],['Houses / week',n(e.housesPerWeek)]]);
  heading('What the numbers say');
  para(`${n(l.replied)} of ${n(l.contacts)} contacted agents have replied (${pct(l.replyRate)}). Of those repliers, ${n(l.replyingHosts)} became confirmed hosts (${pct(l.replyToHostRate)}), accounting for ${n(l.confirmedFromReplies)} open houses.`,11,c.navy);
  para(`This week's outreach cohort: ${counted(w.initial,'initial message')}, ${counted(w.replied,'replying agent')} and ${counted(w.confirmed,'confirmed house')}. Reply rate ${pct(w.replyRate)} (${pp(w.replyRate,p.replyRate)} vs. prior week).`,11,c.navy);
  para(`Buyer activity this week: ${counted(b.totalLeadRecords,'lead record')} - ${counted(b.buyerLeads,'buyer check-in')} plus ${counted(b.profileLeads,'profile / HomeKey lead')}. ${counted(b.producingOpenHouses,'event')} produced leads, averaging ${avg(b.leadsPerProducingOpenHouse)} each.`,11,c.navy);
  heading('Discover  >  Enrich  >  Reach  >  Convert');
  para(`Weekly intake: ${n(w.houses)} houses (${change(w.houses,p.houses)}). ${n(w.enrichedAgents)} distinct agents enriched (${change(w.enrichedAgents,p.enrichedAgents)}). ${w.houses&&!w.enrichedAgents?'Intake continued with no new enrichment records; review pipeline activity before interpreting this as market demand.':'Intake and enrichment are operating activity, not market-size estimates.'}`);

  start('Week in review',`${w.week} compared with ${p.week} / completed Monday-Sunday periods`);
  cards([['Initial outreach',n(w.initial),change(w.initial,p.initial)],['Agents replied',n(w.replied),change(w.replied,p.replied)],['Confirmed houses',n(w.confirmed),change(w.confirmed,p.confirmed)],['Buyer leads',n(b.buyerLeads),`${n(b.producingOpenHouses)} producing events`]]);
  table(['Measure','This week','Prior week','Change'],[
    ['Distinct contacted agents',w.contacts,p.contacts,change(w.contacts,p.contacts)],['Reply rate',pct(w.replyRate),pct(p.replyRate),pp(w.replyRate,p.replyRate)],
    ['Repliers who became hosts',w.replyingHosts,p.replyingHosts,change(w.replyingHosts,p.replyingHosts)],['Reply-to-host conversion',pct(w.replyToHostRate),pct(p.replyToHostRate),pp(w.replyToHostRate,p.replyToHostRate)],
    ['Confirmed houses / initial messages',pct(w.conversionRate),pct(p.conversionRate),pp(w.conversionRate,p.conversionRate)],['Total lead records',b.totalLeadRecords,bp.totalLeadRecords,change(b.totalLeadRecords,bp.totalLeadRecords)],
    ['Buyer leads / producing event',avg(b.leadsPerProducingOpenHouse),avg(bp.leadsPerProducingOpenHouse),'See lead detail'],['Profile / HomeKey lead records',b.profileLeads,bp.profileLeads,change(b.profileLeads,bp.profileLeads)],
    ['New open-house records',w.houses,p.houses,change(w.houses,p.houses)],['Houses enriched',w.enrichedHouses,p.enrichedHouses,change(w.enrichedHouses,p.enrichedHouses)],
    ['Distinct agents enriched',w.enrichedAgents,p.enrichedAgents,change(w.enrichedAgents,p.enrichedAgents)],['Enrichment records',w.enrichmentRows,p.enrichmentRows,change(w.enrichmentRows,p.enrichmentRows)]
  ],[230,92,92,118]);para('Outreach outcomes belong to the initial-send cohort and can mature later. Lead activity, intake and enrichment use their own creation dates. pp = percentage points.',9);

  start('Lead production',`Buyer records captured during the week of ${s.week} / property-level detail`);
  cards([['Total lead records',n(b.totalLeadRecords)],['Buyer check-ins',n(b.buyerLeads)],['Profile / HomeKey',n(b.profileLeads)],['Lifetime lead records',n(s.leads.lifetimeTotal)]]);
  cards([['Leads / producing event',avg(b.leadsPerProducingOpenHouse),`${n(b.producingOpenHouses)} events with leads`],['Leads / recorded event',avg(b.leadsPerRecordedOpenHouse),`${n(b.recordedOpenHouses)} events dated this week`],['Zero-lead events',n(b.zeroLeadOpenHouses),'Included in all-event average']]);
  para(`${n(b.otherEventLeads)} buyer records came from other-date or unverified events; ${n(b.unlinkedBuyerLeads)} have no event link. Profile / HomeKey records remain separate from event averages. Counts represent records, not unique buyers.`,9);
  heading('Leads by open house');table(['Property / event','Event date','Leads','Scope'],b.perOpenHouse.length?b.perOpenHouse.map(r=>[r.address,r.eventDate||'Unknown',r.leads,r.inReportingWeek?'This week':'Other / unverified']):[['No recorded events for this week','-',0,'-']],[280,88,51,113]);
  para('Each row is one recorded event ID; resumed sessions can appear separately. Zero-lead rows include active or ended events dated this week, excluding explicit tests and cancellations. Event activity does not prove outreach attribution.',9);

  start('Lifetime conversion',`Historical outcomes through ${s.generatedAt.slice(0,10)} / cancellations stay in history`);
  cards([['Contact-to-reply',pct(l.replyRate),`${n(l.replied)} / ${n(l.contacts)}`],['Reply-to-host',pct(l.replyToHostRate),`${n(l.replyingHosts)} / ${n(l.replied)}`],['Contact-to-host',pct(l.overallHostRate),`${n(l.contactedHosts)} / ${n(l.contacts)}`]]);
  heading('The conversion story');bars([['Contacted agents',l.contacts],['Agents who replied',l.replied],['Replying agents who hosted',l.replyingHosts]]);
  para(`${n(l.confirmedHosts)} hosts account for ${n(l.confirmed)} confirmed houses, including ${n(l.cancelled)} cancellations. ${n(l.repeatHosts)} hosts confirmed more than one house; ${n(l.hostOptOuts)} hosts have an opt-out. ${n(l.hostsWithoutRecordedReply)} hosts have no recorded post-send reply.`);
  heading('Outbound message mix');bars(Object.entries(l.mix).map(([name,count])=>[`${name} (${pct(count/l.outbound||0)})`,count]));
  heading('Confirmation sources');table(['Source','Confirmed houses'],l.confirmationSources.map(r=>[r.name,r.count]),[420,112]);para('Host rates count each agent once. House counts include repeat hosts. Sends indicate recorded activity, not delivery receipts.',9);

  start('Weekly conversion',`Recent completed initial-send cohorts / outcomes known as of ${s.generatedAt.slice(0,10)}`);
  trend(s.cohorts,'initial','Initial outreach messages',c.cyan,y,40,532,110);y+=130;trend(s.cohorts,'confirmed','Confirmed open houses (separate count scale)',c.blue,y,40,532,90);y+=110;
  table(['Week','Initial','Replied','Reply %','Houses','Conv. %'],s.cohorts.map(r=>[r.week,r.initial,r.replied,pct(r.replyRate),r.confirmed,pct(r.conversionRate)]),[104,75,78,95,80,100]);
  para(`Recent ${s.cohorts.length} cohorts: ${n(s.cohortTotals.recent.confirmed)} / ${n(s.cohortTotals.recent.initial)} = ${pct(s.cohortTotals.recent.conversionRate)} house conversion. All completed cohorts: ${n(s.cohortTotals.all.confirmed)} / ${n(s.cohortTotals.all.initial)} = ${pct(s.cohortTotals.all.conversionRate)}.`,10,c.navy);
  para('Reply % = replying agents / contacted agents. Conv. % = confirmed houses / initial messages. Charts use separate, directly labeled count scales. N/A means no denominator.',9);

  start('Relationship network','Current engagement states / historical hosts remain in conversion history');
  cards([['Active relationships',n(s.relationships.active)],['Historical hosts',n(l.confirmedHosts)],['Engaged universe',n(s.relationships.universe)]]);
  heading('Current status');bars(Object.entries(s.relationships.statuses).map(([name,count])=>[name.replace(/_/g,' '),count]));
  heading('Leading brokerages in the active network');bars(s.relationships.brokerages.slice(0,8).map(r=>[r.name,r.count]),250,220);
  para('Statuses are mutually exclusive: opt-out, not-now, confirmed, interested, then replied. Active excludes opt-out and not-now. Shared contact information never merges conflicting usable names.',9);

  start('The data engine','Discovery and enrichment cadence / completed weeks include zero activity');
  cards([['Open-house records',n(e.houses)],['Houses / week',n(e.housesPerWeek),`Recent: ${n(e.recentHousesPerWeek)}`],['Agents / week',n(e.agentsPerWeek),`Recent: ${n(e.recentAgentsPerWeek)}`]]);
  trend(s.cohorts,'houses','Weekly open-house intake',c.cyan,y,40,250,120);trend(s.cohorts,'enrichedAgents','Weekly agents enriched',c.blue,y,322,250,120);y+=148;
  const sources=[...new Set([...e.houseSourcesPerWeek,...e.agentSourcesPerWeek].map(r=>r.name))].map(name=>[name,e.houseSourcesPerWeek.find(r=>r.name===name)?.perWeek||0,e.agentSourcesPerWeek.find(r=>r.name===name)?.perWeek||0]);
  const major=sources.filter(r=>Math.max(r[1],r[2])>=1),minor=sources.filter(r=>Math.max(r[1],r[2])<1);
  if(minor.length)major.push(['Other sources (<1 / week each)',minor.reduce((a,r)=>a+r[1],0),minor.reduce((a,r)=>a+r[2],0)]);
  heading('Average weekly volume by source');table(['Source','Houses / week','Agents / week'],major.map(r=>[r[0],n(r[1]),n(r[2])]),[300,116,116]);
  para(`${n(e.recordWithoutFlag)} houses have enrichment records with the flag off. ${n(e.flagWithoutRecord)} have the flag on without a matching enrichment record. These are reconciliation signals, not automatic proof of failed enrichment.`,10,c.navy);
  para(`Averages span ${e.firstWeek} through ${s.week}: ${e.completedWeeks} completed weeks. Enrichment uses agent-record creation time. Source-specific agent counts may overlap; overall cadence deduplicates agents within each week.`,9);

  start('Definitions & integrity','A reproducible saved snapshot / explicit denominators and source boundaries');
  table(['Measure','Definition'],[['Reply-to-host conversion','Distinct replying agents with a confirmed house / distinct replying agents.'],['Overall host conversion','Contacted agents with a confirmed house / distinct contacted agents.'],['House conversion','Confirmed houses / initial outreach messages in the same initial-send cohort.'],['Leads per producing event','Linked buyer records created this week / distinct events with those records.'],['Leads per recorded event','This-week buyer records for eligible events dated this week / all such events, including zeros.'],['Lifetime lead records','Buyer check-in records plus separate profile / HomeKey lead records.']],[171,361]);
  para(`Source quality: ${n(s.quality.missingContactIdentity)} contacted rows lack usable contact identity; ${n(s.quality.unmatchedInbound)} inbound records lack a matching queue link. Unambiguous contact fallback is attempted.`,9);
  s.notes.forEach(note=>para(note,8.5,c.muted,7));
  const pages=pdf.getPages();pages.forEach((p,i)=>{page=p;line(40,747,572,747);text('REL8TION COMMAND',40,758,8,true);text(`rel8tion.me / ${s.week} / Private owner report`,178,758,8,false,c.muted);text(`${i+1} / ${pages.length}`,542,758,8,false,c.muted);});return pdf.save();
}
module.exports={renderPdf,emailHtml};
