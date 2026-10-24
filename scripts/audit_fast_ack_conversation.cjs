const fs=require('node:fs'),assert=require('node:assert/strict');
const file=process.argv[2];if(!file)throw Error('Supply the conversation report path');
const report=JSON.parse(fs.readFileSync(file,'utf8'));
const turns=report.turns;
report.acceptance={
 sixTurnsComplete:turns.length===6&&turns.every(t=>t.delivery==='complete'&&!t.error),
 everyToolAcknowledged:turns.every(t=>t.orderingPassed),
 acknowledgmentsInBangla:turns.every(t=>t.transcripts.filter(e=>e.phase==='progress'&&e.delivery==='complete').every(e=>/[\u0980-\u09ff]/.test(e.text))),
 noBareAcknowledgments:turns.every(t=>t.transcripts.filter(e=>e.phase==='progress'&&e.delivery==='complete').every(e=>!/^(?:আচ্ছা|ওকে|ঠিক আছে|okay|sure)[.!।\s]*$/i.test(e.text))),
 answersInBangla:turns.every(t=>/[\u0980-\u09ff]/.test(t.answer||'')),
 searchAnsweredTopic:/বিদ্যু(?:ৎ|ত)/.test(turns[3]?.answer||'')&&/সূর্য|আলো|সোলার|সৌর/.test(turns[3]?.answer||''),
 searchCitesOfficialSource:/https:\/\/(?:www\.)?(?:energy\.gov(?:\.au)?|eia\.gov)\//.test(turns[3]?.answer||''),
 officialFactRead:turns[3]?.operations.some(o=>o.name==='read_web_page'&&o.result?.status==='ok'&&o.result?.source==='direct_page'&&/https:\/\/(?:www\.)?(?:energy\.gov(?:\.au)?|eia\.gov)\//.test(o.result.url||'')&&/photovoltaic|electricity|sunlight/i.test(o.result.content||'')),
 multistepCompleted:turns[4]?.operations.length>=2&&/উদাহরণ|ডকুমেন্টেশন/.test(turns[4]?.answer||'')&&/টুল|এপিআই|ফাংশন/.test(turns[4]?.answer||''),
 retainedFollowupAvoidedTools:turns[5]?.operations.length===0,
};
fs.writeFileSync(file,JSON.stringify(report,null,2));console.log(JSON.stringify(report.acceptance,null,2));
assert.ok(Object.values(report.acceptance).every(Boolean),'Conversation acceptance failed; inspect retained report');
