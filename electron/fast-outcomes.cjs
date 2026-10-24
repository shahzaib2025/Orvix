const catalog = /(?:\ball\b|\bevery\b|সব(?:গুলো|গুলা)?|সকল|প্রতিটি).{0,45}(?:products?|catalog|প্রোডাক্ট|পণ্য)/i;
const windows = /(?:\ball\b|\bevery\b|\bs[ho]*ob\b|সব(?:গুলো|গুলা)?|সকল|প্রতিটি).{0,45}(?:windows?|উইন্ডো)/i;
const weather = /\b(?:weather|forecast|get_weather)\b|আবহাওয়া|আবহাওয়া|ওয়েদার|ওয়েদার/i;
function requireOutcomes(task, text) {
  const add = (id, label, kind = 'research') => {
    if (!task.requirements.some(r => r.id === id)) task.requirements.push({ id, text: label, kind, status: 'pending', evidenceIds: [], controllerOwned: true });
  };
  if (catalog.test(text)) {
    task.catalogRequested = true;
    add('catalog-scope', 'Identify the actual full product catalog and check all listing pages and remaining pagination; a homepage sample is insufficient.');
    add('catalog-details', 'Report every discovered product with its requested details and source-backed prices; explicitly identify inaccessible or unchecked products.');
    task.planRequired = true;
  }
  if (windows.test(text) && /minimi[sz]e|maximi[sz]e|close|restore|মিনিমাইজ|ম্যাক্সিমাইজ|বন্ধ|রিস্টোর/i.test(text)) {
    task.allWindowsRequested = true;
    add('window-inventory', 'Observe the complete current target window inventory before acting.', 'outcome');
    add('window-results', 'Verify the requested state separately for every observed target window and report any remaining window.', 'outcome');
    task.planRequired = true;
  }
  if (/\b(?:research|compare|comparison|investigate|multi.step)\b|গবেষণা|তুলনা|কম্পেয়ার|কম্পেয়ার/i.test(text)) task.planRequired = true;
  if(/windows?|উইন্ডো/i.test(text) && /compare.{0,80}(?:earlier|previous)|আগের.{0,60}তুলনা/i.test(text))add('window-comparison','Compare the current native window titles with the retained earlier observation, or explicitly state that an earlier observation is unavailable.','outcome');
}
function acknowledgmentOnly(answer) {
  return !answer.trim() || /^(?:i will|i'll|let me|checking|researching)\b/i.test(answer.trim()) || /(?:দেখে নিচ্ছি|খুঁজে দেখছি|যাচাই করে নিচ্ছি|শুরু করছি|করব|করবো)[।.!]?\s*$/i.test(answer.trim());
}
function digits(value) { return String(value || '').replace(/[০-৯]/g, c => String('০১২৩৪৫৬৭৮৯'.indexOf(c))); }
function weatherCovered(answer, evidence, field='temperature') {
  const text = digits(answer).toLowerCase();
  return evidence.some(e => {
    const temperature = digits(e[field]).match(/-?\d+(?:\.\d+)?/)?.[0];
    const city = String(e.location || '').split(',')[0].trim().toLowerCase();
    const aliases = { dhaka: 'ঢাকা', chattogram: 'চট্টগ্রাম', rajshahi: 'রাজশাহী', khulna: 'খুলনা', barishal: 'বরিশাল', sylhet: 'সিলেট', rangpur: 'রংপুর', mymensingh: 'ময়মনসিংহ' };
    if (!temperature || !city) return false;
    const names=[city,aliases[city]].filter(Boolean);
    const mentions=[...new Set([...Object.keys(aliases),...Object.values(aliases),city])].flatMap(name=>
      [...text.matchAll(new RegExp(`(?<![\\p{L}])${name}(?![a-z])`,'gu'))].map(m=>({name,start:m.index,end:m.index+m[0].length}))).sort((a,b)=>a.start-b.start);
    const value=new RegExp(`(?<![\\d.])${temperature.replace('.', '\\.')}(?![\\d.])\\s*(?:°?\\s*c\\b|degrees(?!\\s*(?:f\\b|fahrenheit))|celsius|ডিগ্রি(?!\\s*ফারেনহাইট)|সেলসিয়াস|সেলসিয়াস)`, 'gi');
    return mentions.some((mention,index)=>{
      if(!names.includes(mention.name))return false;
      const segment=text.slice(mention.end,mentions[index+1]?.start ?? text.length);
      return [...segment.matchAll(value)].some(match=>{
        const prefix=segment.slice(0,match.index);
        if(field==='feelsLike')return /feels.like|অনুভূত|অনুভব/i.test(prefix) && !/warmer|colder|difference|পার্থক্য/i.test(prefix);
        return !/warmer|colder|cooler|difference|higher|lower|feels like|humidity|high of|low of|বেশি|কম|পার্থক্য|অনুভূত/i.test(prefix);
      });
    });
  });
}
function reviewOutcomeIssues(task, answer, evidence) {
  const issues = [], weatherEvidence = evidence.filter(e => e.tool === 'get_weather' && e.temperature);
  if (weather.test(task.goal + ' ' + task.latestRequest) && weatherEvidence.length && !weatherCovered(answer, weatherEvidence)) issues.push('Report the observed location and actual temperature; a weather acknowledgement is not the requested result.');
  for (const r of task.requirements.filter(r => r.kind === 'weather')) {
    const sources = weatherEvidence.filter(e => task.steps.find(s => s.id === e.stepId)?.requirementIds.includes(r.id));
    if (sources.length && !weatherCovered(answer, sources)) issues.push(`${r.id}: observed city and temperature are missing from the answer.`);
  }
  const weatherRequest=task.goal+' '+(task.latestRequest || '');
  if(/feels.like|অনুভূত|অনুভব/i.test(weatherRequest))for(const source of weatherEvidence)if(source.feelsLike && !weatherCovered(answer,[source],'feelsLike'))issues.push(`Report the observed feels-like reading for ${String(source.location).split(',')[0]}; actual temperature alone does not satisfy it.`);
  const native=evidence.filter(e=>e.tool==='desktop_observe' && e.windows).at(-1);
  if(native && /visible application windows?/i.test(task.latestRequest || task.goal)) {
    const allowed=native.visibleApplicationWindows || [];
    if(allowed.length && !allowed.some(w=>answer.includes(w.title)))issues.push('Report an observed non-minimized application title, using visibleApplicationWindows rather than internal notification windows.');
    if(native.windows.some(w=>!allowed.some(a=>a.ref===w.ref) && answer.includes(w.title) && !answer.split(/(?<=[.!?।])\s+|\n/).filter(sentence=>sentence.includes(w.title)).every(sentence=>/\b(?:is|was|are|currently) (?:minimi[sz]ed|a (?:system|notification) window)|\b(?:not visible|not an application|excluded from|excluding)\b|মিনিমাইজ করা|দৃশ্যমান নয়|বাদ দেওয়া/i.test(sentence))))issues.push('A minimized or internal window was reported as a visible application window.');
  }
  if(task.requirements.some(r=>r.id==='window-comparison') && !/unchanged|same|new|added|removed|closed|earlier|previous|changed|আগের|পরিবর্তন|অপরিবর্তিত/i.test(answer))issues.push('The requested comparison with the earlier native observation is missing. Use the observed windowComparison or state that no earlier observation is available.');
  if (task.allWindowsRequested) {
    const inventory = evidence.filter(e => e.tool === 'desktop_observe' && e.windows).at(-1)?.windows;
    if (!inventory?.length) issues.push('A fresh complete window inventory is required to verify all windows.');
    else {
      const handles = inventory.map(w => Number(w.handle || String(w.ref || '').split(':').at(-1))).filter(Boolean);
      const action=/minimi[sz]e|মিনিমাইজ/i.test(task.goal)?'minimize':/maximi[sz]e|ম্যাক্সিমাইজ/i.test(task.goal)?'maximize':/restore|রিস্টোর/i.test(task.goal)?'restore':'close';
      const done = new Set(evidence.filter(e => e.tool === 'window_act' && e.handle && task.steps.find(s=>s.id===e.stepId)?.action===action).map(e => Number(e.handle)));
      if (!handles.length || handles.some(handle => !done.has(handle))) issues.push('Some observed target windows have no independently verified action result.');
    }
  }
  if (task.catalogRequested) {
    const pages = evidence.filter(e => e.tool === 'read_web_page');
    if (!pages.some(e => /\/(?:shop|products?|catalog|collections?|categor(?:y|ies))\b/i.test(e.sourceUrl))) issues.push('Read the actual catalog listing; a homepage excerpt does not establish the full product inventory.');
    for (const page of pages) {
      if (page.truncated || Number.isFinite(page.totalCharacters)) {
        const sections=pages.filter(e=>e.sourceUrl===page.sourceUrl&&Number.isInteger(e.offset)).sort((a,b)=>a.offset-b.offset);
        let readTo=0;
        for (const section of sections) {if(section.offset>readTo)break;readTo=Math.max(readTo,section.offset+(section.excerpt||'').length);}
        if (!Number.isFinite(page.totalCharacters) || readTo<page.totalCharacters) issues.push('A retrieved catalog or product page still has unread content.');
      }
      if (page.linksTruncated) issues.push('Catalog navigation was truncated; the full inventory remains unverified.');
      if ((page.links || []).some(link => /\/(?:products?|shop|catalog|collections?|categor(?:y|ies))\b|[?&](?:page|paged)=/i.test(link.url) && !pages.some(e => e.sourceUrl === link.url))) issues.push('Published catalog/product links remain unchecked; report partial coverage or continue the listing.');
    }
  }
  return [...new Set(issues)];
}
module.exports = { requireOutcomes, acknowledgmentOnly, reviewOutcomeIssues };
