const number = (value) => Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 1 });
const percent = (value) => value == null ? 'N/A' : `${(value * 100).toFixed(1)}%`;
const change = (current, prior) => prior ? `${current >= prior ? '+' : ''}${((current - prior) / prior * 100).toFixed(1)}%` : current ? `+${number(current)} (from zero)` : 'No change';
const clean = (value) => String(value ?? '').normalize('NFKD').replace(/[^\x20-\x7E\n]/g, '').trim();
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function emailHtml(s) {
  return `<div style="font-family:Arial,sans-serif;max-width:680px;margin:auto;color:#122b46"><div style="background:#122b46;color:white;padding:26px"><div style="color:#62d4df">REL8TION</div><h1>Outreach Performance Brief</h1><p>Week of ${esc(s.week)} | New York time</p></div><div style="padding:24px"><p><strong>${number(s.lifetime.outbound)}</strong> recorded outbound messages &nbsp; <strong>${number(s.lifetime.confirmed)}</strong> historical confirmations &nbsp; <strong>${number(s.relationships.active)}</strong> active relationships</p><p>This week: ${number(s.current.initial)} initial outreach messages, ${number(s.current.replied)} agents replied, and ${number(s.current.confirmed)} confirmations attributed to that outreach cohort as of generation.</p><p>Your six-page PDF is attached. It includes the executive summary, week in review, lifetime funnel, weekly cohorts, relationship network, and data engine.</p><p><a href="https://app.rel8tion.me/command?area=reports">Open the saved report archive in COMMAND</a></p><p style="font-size:12px;color:#60738a">Saved ${esc(s.generatedAt)}. Cohort outcomes can mature in later briefs; this snapshot stays unchanged. Recorded sends are not delivery receipts.</p></div></div>`;
}

async function renderPdf(s) {
  const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
  const pdf = await PDFDocument.create();
  pdf.setTitle(`REL8TION Outreach Performance Brief - ${s.week}`);
  pdf.setAuthor('REL8TION'); pdf.setSubject('Weekly outreach, relationships, lead capture and data operations');
  pdf.setCreationDate(new Date(s.generatedAt)); pdf.setModificationDate(new Date(s.generatedAt));
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const C = { navy: rgb(.07, .16, .27), cyan: rgb(.02, .62, .70), muted: rgb(.36, .43, .51), light: rgb(.94, .97, .98), line: rgb(.84, .9, .93), white: rgb(1, 1, 1) };
  let page, y;
  const text = (value, x, top, size = 11, strong = false, color = C.navy) => page.drawText(clean(value), { x, y: 792 - top - size, size, font: strong ? bold : regular, color });
  const box = (x, top, width, height, color) => page.drawRectangle({ x, y: 792 - top - height, width, height, color });
  function lines(value, width, size = 11, strong = false) {
    const font = strong ? bold : regular;
    const result = [];
    for (const paragraph of clean(value).split('\n')) {
      let line = '';
      for (const word of paragraph.split(/\s+/)) {
        if (line && font.widthOfTextAtSize(`${line} ${word}`, size) > width) { result.push(line); line = ''; }
        line = line ? `${line} ${word}` : word;
      }
      result.push(line);
    }
    return result;
  }
  function paragraph(value, size = 11, color = C.muted, gap = 10) {
    for (const line of lines(value, 524, size)) { text(line, 44, y, size, false, color); y += size * 1.45; }
    y += gap;
    if (y > 736) throw new Error('Outreach PDF content exceeds page bounds.');
  }
  function heading(value) { text(value, 44, y, 15, true); y += 29; }
  function start(title, subtitle, index) {
    page = pdf.addPage([612, 792]);
    box(0, 0, 612, 119, C.navy); box(0, 119, 612, 4, C.cyan);
    text('REL8TION  /  OUTREACH PERFORMANCE BRIEF', 44, 24, 10, true, C.white);
    text(title, 44, 49, 25, true, C.white);
    text(subtitle, 44, 88, 10, false, C.white);
    box(44, 748, 524, 1, C.line);
    text(`Week of ${s.week} | Saved ${s.generatedAt.slice(0, 10)} | Private owner report`, 44, 760, 8, false, C.muted);
    text(`${index} / 6`, 544, 760, 8, false, C.muted);
    y = 146;
  }
  function cards(items) {
    const width = (524 - (items.length - 1) * 10) / items.length;
    items.forEach(([label, value], i) => {
      const x = 44 + i * (width + 10); box(x, y, width, 81, C.light);
      text(value, x + 12, y + 10, 24, true);
      lines(label, width - 24, 9).forEach((line, j) => text(line, x + 12, y + 46 + j * 12, 9, false, C.muted));
    });
    y += 105;
  }
  function table(headers, rows, widths, size = 10) {
    let x = 44; box(44, y, 524, 27, C.navy);
    headers.forEach((label, i) => { text(label, x + 8, y + 8, size, true, C.white); x += widths[i]; }); y += 27;
    rows.forEach((row, index) => {
      const wrapped = row.map((cell, i) => lines(cell, widths[i] - 16, size));
      const height = Math.max(28, Math.max(...wrapped.map((cell) => cell.length)) * (size + 4) + 13);
      if (y + height > 733) throw new Error('Outreach PDF table exceeds page bounds.');
      if (index % 2 === 0) box(44, y, 524, height, C.light);
      let cellX = 44;
      wrapped.forEach((cell, i) => { cell.forEach((line, j) => text(line, cellX + 8, y + 7 + j * (size + 4), size)); cellX += widths[i]; }); y += height;
    }); y += 18;
  }
  function bars(rows, maximum, labelWidth = 150) {
    for (const [label, value] of rows) {
      text(label, 44, y + 2, 10); box(44 + labelWidth, y, 310, 17, C.light);
      box(44 + labelWidth, y, maximum ? 310 * value / maximum : 0, 17, C.cyan);
      text(number(value), 44 + labelWidth + 321, y + 2, 10, true); y += 28;
    } y += 15;
  }
  const l = s.lifetime, w = s.current, p = s.prior, e = s.engine;
  start('Executive Summary', `Week of ${s.week} | Completed Monday-Sunday period | America/New_York`, 1);
  cards([['Recorded outbound', number(l.outbound)], ['Ever confirmed', number(l.confirmed)], ['Active relationships', number(s.relationships.active)], ['Houses / week', number(e.housesPerWeek)]]);
  heading('What the numbers say');
  paragraph(`${number(l.contacts)} distinct agents have been contacted; ${number(l.replied)} have replied (${percent(l.replyRate)}). ${number(l.confirmedHosts)} distinct agents have hosted a recorded confirmation.`);
  paragraph(`The latest completed week produced ${number(w.initial)} initial outreach messages and ${number(w.replied)} replying agents (${percent(w.replyRate)} of distinct contacts). Its ${number(w.confirmed)} confirmed open houses reflect outcomes known when this brief was saved.`);
  paragraph(`Intake was ${number(w.houses)} open houses (${change(w.houses, p.houses)} versus the prior week). Enrichment covered ${number(w.enrichedAgents)} distinct agent identities (${change(w.enrichedAgents, p.enrichedAgents)}).`);
  paragraph(`${number(w.buyerCheckins)} buyer check-in records came from ${number(w.producingEvents)} events this week, plus ${number(w.profileLeads)} profile / HomeKey lead records. These are activity counts, not attributed sales.`);
  heading('The operating loop');
  cards([['Discover houses', '01'], ['Enrich agents', '02'], ['Reach agents', '03'], ['Convert to events', '04']]);
  paragraph('Historical confirmations remain counted after cancellation or opt-out. Each saved brief is immutable; later briefs can show matured cohort outcomes.', 10);

  start('Week in Review', `${w.week} compared with ${p.week} | Cohort outcomes as of ${s.generatedAt.slice(0, 10)}`, 2);
  cards([['Initial messages', number(w.initial)], ['Reply rate', percent(w.replyRate)], ['Confirmed houses', number(w.confirmed)]]);
  table(['Measure', 'This week', 'Prior week', 'Change'], [
    ['Initial outreach messages', w.initial, p.initial, change(w.initial, p.initial)],
    ['Distinct contacted agents', w.contacts, p.contacts, change(w.contacts, p.contacts)],
    ['Agents replied to cohort', w.replied, p.replied, change(w.replied, p.replied)],
    ['Confirmed houses in cohort', w.confirmed, p.confirmed, change(w.confirmed, p.confirmed)],
    ['Buyer check-in records', w.buyerCheckins, p.buyerCheckins, change(w.buyerCheckins, p.buyerCheckins)],
    ['Events with buyer check-ins', w.producingEvents, p.producingEvents, change(w.producingEvents, p.producingEvents)],
    ['Profile / HomeKey lead records', w.profileLeads, p.profileLeads, change(w.profileLeads, p.profileLeads)],
    ['New open-house records', w.houses, p.houses, change(w.houses, p.houses)],
    ['Houses enriched', w.enrichedHouses, p.enrichedHouses, change(w.enrichedHouses, p.enrichedHouses)],
    ['Distinct agents enriched', w.enrichedAgents, p.enrichedAgents, change(w.enrichedAgents, p.enrichedAgents)],
    ['Enrichment records', w.enrichmentRows, p.enrichmentRows, change(w.enrichmentRows, p.enrichmentRows)]
  ], [215, 89, 89, 131]);
  paragraph('Reply and confirmation outcomes are assigned to the initial-send cohort and can mature after that week ends. Intake, enrichment and lead records use their own creation week. Changes from a zero denominator are shown as counts.', 10);

  start('Lifetime Outreach Funnel', `Recorded activity through ${s.generatedAt.slice(0, 10)} | Preserved historical outcomes`, 3);
  cards([['Distinct contacts', number(l.contacts)], ['Agents replied', number(l.replied)], ['Confirmed hosts', number(l.confirmedHosts)]]);
  heading('Outbound message mix');
  bars([['Initial outreach', l.mix.initial], ['Follow-up', l.mix.followup], ['Conversation', l.mix.conversation]], Math.max(1, ...Object.values(l.mix)));
  table(['Historical outcome', 'Count'], [
    ['Confirmed open houses, including later cancellations', l.confirmed],
    ['Of those: currently cancelled', l.cancelled],
    ['Confirmed hosts with a recorded opt-out', l.hostOptOuts],
    ['Hosts with more than one confirmed open house', l.repeatHosts],
    ['Lifetime buyer check-in records', l.buyerCheckins],
    ['Lifetime profile / HomeKey lead records', l.profileLeads]
  ], [422, 102]);
  paragraph('Initial and follow-up provider IDs are excluded from conversation-message totals. Recorded send timestamps do not establish handset delivery. Confirmations are deduplicated by house and event date; they are not a sales or revenue measure.', 10);

  start('Weekly Conversion', 'Recent completed initial-send cohorts | Outcomes can mature in subsequent briefs', 4);
  heading('Initial outreach volume');
  bars(s.cohorts.map((row) => [row.week, row.initial]), Math.max(1, ...s.cohorts.map((row) => row.initial)), 105);
  table(['Week of', 'Initial', 'Replied', 'Reply %', 'Confirmed', 'Conv. %'], s.cohorts.map((row) => [row.week, row.initial, row.replied, percent(row.replyRate), row.confirmed, percent(row.conversionRate)]), [104, 70, 75, 90, 95, 90], 9);
  paragraph('Reply % = distinct replying agents / distinct contacted agents. Conv. % = confirmed houses / initial messages. The two rates intentionally have different denominators. N/A means no denominator.', 9);

  start('Relationship Network', 'Current engagement states | Suppression and not-now states excluded from active counts', 5);
  cards([['Active relationships', number(s.relationships.active)], ['Engaged / opted-out universe', number(s.relationships.universe)], ['Historical hosts', number(l.confirmedHosts)]]);
  table(['Current status (mutually exclusive)', 'Agents'], Object.entries(s.relationships.statuses).map(([name, count]) => [name.replace(/_/g, ' '), count]), [422, 102]);
  heading('Leading brokerages in the active network');
  table(['Brokerage', 'Active agents'], s.relationships.brokerages.slice(0, 5).map((row) => [clean(row.name).slice(0, 70), row.count]), [422, 102]);
  paragraph('Priority: opt-out, not-now, confirmed, interested, replied. Phone/email identities require compatible names; conflicting names stay separate. These are current source states at generation time. COMMAND lists the top ten brokerages.', 9);

  start('Data Engine & Definitions', 'Intake and enrichment cadence | Source quality and reproducibility', 6);
  cards([['Open-house records', number(e.houses)], ['Houses / completed week', number(e.housesPerWeek)], ['Agents / completed week', number(e.agentsPerWeek)]]);
  table(['Cadence / quality', 'Value'], [
    ['Recent 8 completed weeks: houses / week', number(e.recentHousesPerWeek)],
    ['Recent 8 completed weeks: distinct agents / week', number(e.recentAgentsPerWeek)],
    ['Enrichment record exists; house flag is off', e.recordWithoutFlag],
    ['House flag is on; no enrichment record found', e.flagWithoutRecord],
    ['Contacted queue rows without phone or email', s.quality.missingContactIdentity],
    ['Inbound records without a matching queue link', s.quality.unmatchedInbound]
  ], [422, 102]);
  paragraph(`Cadence averages include zero-activity weeks from ${e.firstWeek} through ${s.week} (${e.completedWeeks} completed weeks). Enrichment cadence counts when agent records were created, not when their house was discovered.`, 9);
  heading('How to read this brief');
  s.notes.forEach((note) => paragraph(note, 8.5, C.muted, 4));
  return pdf.save();
}
module.exports = { renderPdf, emailHtml, number, percent, change };
