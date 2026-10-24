const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createTinyAgents, validateRule } = require('../electron/tiny-agents.cjs');
const { createTinyAgentSensors } = require('../electron/tiny-agent-sensors.cjs');
const base = Date.parse('2026-10-01T06:00:00Z');
const rule = extra => ({ name: 'Brightness changes', trigger: { type: 'change', watches: [{ signal: 'brightness_percent' }], settleSeconds: 1 }, action: { type: 'notify', message: '' }, ...extra });
const pc = (Brightness, extra = {}) => ({ Brightness, Volume: 30, Muted: false, OnAcPower: false, Windows: [{ App: 'editor', Active: true }], Activity: { IsPresentationOrFullscreen: false }, ...extra });
function fixture(input = rule()) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orvix-changes-')), notices = [];
  const app = { getPath: () => dir }, effects = { notify: (title, body, meta) => { notices.push({title,body,meta}); return {status:'shown'}; } };
  const engine = createTinyAgents(app, effects), id = engine.draft(input).rule.id; engine.approve(id);
  return { engine, id, dir, notices, reopen: () => createTinyAgents(app,effects), close: () => fs.rmSync(dir,{recursive:true,force:true}) };
}
test('one-point change settles once; approval and repeated readings do not notify', () => {
  const f = fixture(); try {
    f.engine.ingest(pc(50),base); f.engine.ingest(pc(51),base+100); f.engine.tick(base+1099); assert.equal(f.notices.length,0);
    f.engine.tick(base+1100); assert.equal(f.notices.length,1); assert.match(f.notices[0].body,/Brightness: 50% → 51%/); assert.equal(f.notices[0].meta.ruleId,f.id);
    f.engine.ingest(pc(51),base+2000); f.engine.tick(base+3000); assert.equal(f.notices.length,1);
  } finally { f.close(); }
});
test('slider burst combines changes and returning to start suppresses the alert', () => {
  const f = fixture(); try {
    f.engine.ingest(pc(50),base); f.engine.ingest(pc(55),base+100); f.engine.ingest(pc(60),base+400);
    f.engine.tick(base+1300); assert.equal(f.notices.length,0); f.engine.tick(base+1400); assert.match(f.notices[0].body,/50% → 60%/);
    f.engine.ingest(pc(70),base+2000); f.engine.ingest(pc(60),base+2300); f.engine.tick(base+3300); assert.equal(f.notices.length,1);
  } finally { f.close(); }
});
test('minimum deltas accumulate and direction filters rebase opposite movement', () => {
  const f = fixture(rule({ trigger:{type:'change',watches:[{signal:'brightness_percent',minDelta:5,direction:'increase'}],settleSeconds:1} })); try {
    f.engine.ingest(pc(50),base); f.engine.ingest(pc(52),base+100); f.engine.tick(base+1100); assert.equal(f.notices.length,0);
    f.engine.ingest(pc(55),base+2000); f.engine.tick(base+3000); assert.match(f.notices[0].body,/50% → 55%/);
    f.engine.ingest(pc(40),base+4000); f.engine.tick(base+5000); assert.equal(f.notices.length,1);
    f.engine.ingest(pc(45),base+6000); f.engine.tick(base+7000); assert.match(f.notices[1].body,/40% → 45%/);
  } finally { f.close(); }
});
test('missing/stale readings, device replacements, restart, resume and long gaps establish baselines', () => {
  const f = fixture(); try {
    f.engine.ingest(pc(50,{SignalSources:{brightness_percent:'display-a'}}),base);
    f.engine.ingest(pc(80,{SignalSources:{brightness_percent:'display-b'}}),base+100); f.engine.tick(base+1100); assert.equal(f.notices.length,0);
    f.engine.ingest(pc(null),base+2000); assert.equal(f.engine.preview(f.id,base+2000).watches[0].actual,null);
    f.engine.ingest(pc(40),base+3000); f.engine.tick(base+4000); assert.equal(f.notices.length,0);
    f.engine.ingest(pc(90),base+20000); f.engine.tick(base+21000); assert.equal(f.notices.length,0);
    f.engine.tick(base+40000); assert.equal(f.engine.list().rules[0].availability,'unavailable');
    f.engine.ingest(pc(20),base+41000); f.engine.tick(base+42000); assert.equal(f.notices.length,0);
    const reopened=f.reopen(); reopened.ingest(pc(70),base+43000); reopened.tick(base+44000); assert.equal(f.notices.length,0);
    reopened.reset(); reopened.ingest(pc(90),base+45000); reopened.tick(base+46000); assert.equal(f.notices.length,0);
    reopened.setEnabled(f.id,false); reopened.setEnabled(f.id,true); reopened.ingest(pc(10),base+47000); reopened.tick(base+48000); assert.equal(f.notices.length,0);
  } finally { f.close(); }
});
test('preview is read-only and reports pending change values and settling time', () => {
  const f=fixture(); try {
    f.engine.ingest(pc(50),base); f.engine.ingest(pc(51),base+100);
    const file=path.join(f.dir,'tiny-agents.json'), before=fs.readFileSync(file,'utf8');
    const p=f.engine.preview(f.id,base+500); assert.equal(p.watches[0].baseline,50); assert.equal(p.watches[0].actual,51); assert.equal(p.watches[0].pending,true); assert.equal(p.watches[0].settleRemaining,0.6);
    f.engine.preview(f.id,base+1500); assert.equal(fs.readFileSync(file,'utf8'),before); assert.equal(f.notices.length,0);
    f.engine.tick(base+1500); assert.equal(f.notices.length,1);
  } finally { f.close(); }
});
test('multiple numeric, boolean and active-app watches notify with the changed values', () => {
  const f=fixture(rule({trigger:{type:'change',watches:[{signal:'volume_percent'},{signal:'muted'},{signal:'active_app'},{signal:'on_ac'}],settleSeconds:1}})); try {
    f.engine.ingest(pc(50),base); f.engine.ingest(pc(50,{Volume:31,Muted:true,OnAcPower:true,Windows:[{App:'browser',Active:true}]}),base+100); f.engine.tick(base+1100);
    assert.equal(f.notices.length,1); for(const text of ['Volume: 30% → 31%','Muted: no → yes','Power connected: no → yes','Active app: editor → browser']) assert.ok(f.notices[0].body.includes(text));
    assert.equal(f.engine.list().history.find(e=>e.kind==='triggered').changes.length,4);
  } finally { f.close(); }
});
test('filters discard events rather than firing later; later qualifying changes still notify', () => {
  const f=fixture(rule({condition:{op:'predicate',signal:'on_ac',comparator:'eq',value:true}})); try {
    f.engine.ingest(pc(50),base); f.engine.ingest(pc(51),base+100); f.engine.tick(base+1100); assert.equal(f.notices.length,0);
    f.engine.ingest(pc(51,{OnAcPower:true}),base+2000); f.engine.tick(base+3000); assert.equal(f.notices.length,0);
    f.engine.ingest(pc(52,{OnAcPower:true}),base+4000); f.engine.tick(base+5000); assert.match(f.notices[0].body,/51% → 52%/);
  } finally { f.close(); }
});
test('quiet hours merge pending changes and restart delivers their original values once', () => {
  const f=fixture(rule({schedule:{mode:'always',timezone:'UTC'},policy:{quietHours:{enabled:true,start:'22:00',end:'08:00'}}})); try {
    const night=Date.parse('2026-10-01T23:00:00Z');
    f.engine.ingest(pc(50),night); f.engine.ingest(pc(51),night+100); f.engine.tick(night+1100);
    f.engine.ingest(pc(55),night+2000); f.engine.tick(night+3000); assert.equal(f.notices.length,0);
    assert.equal(f.engine.list().rules[0].pendingNotification.changes[0].count,2);
    const reopened=f.reopen(); reopened.tick(Date.parse('2026-10-02T08:00:00Z')); assert.equal(f.notices.length,1); assert.match(f.notices[0].body,/50% → 55%/);
    reopened.tick(Date.parse('2026-10-02T08:00:01Z')); assert.equal(f.notices.length,1);
  } finally { f.close(); }
});
test('cooldown queues and merges new events, daily limit queues until the next day', () => {
  const f=fixture(rule({policy:{cooldownSeconds:10,maxPerDay:2},schedule:{mode:'always',timezone:'UTC'}})); try {
    f.engine.ingest(pc(50),base); f.engine.ingest(pc(51),base+100); f.engine.tick(base+1100);
    f.engine.ingest(pc(52),base+2000); f.engine.tick(base+3000); f.engine.ingest(pc(53),base+4000); f.engine.tick(base+5000); assert.equal(f.notices.length,1);
    f.engine.ingest(pc(53),base+11100); assert.equal(f.notices.length,2); assert.match(f.notices[1].body,/51% → 53%/);
    f.engine.ingest(pc(54),base+12000); f.engine.tick(base+13000); assert.equal(f.notices.length,2);
    f.reopen().tick(base+86400000); assert.equal(f.notices.length,3);
  } finally { f.close(); }
});
test('time-window events are consumed outside the window; snooze and fullscreen queue summaries', () => {
  const f=fixture(rule({schedule:{mode:'window',start:'07:00',end:'08:00',timezone:'UTC',days:[4]},policy:{deferFullscreen:true}})); try {
    f.engine.ingest(pc(50),base); f.engine.ingest(pc(51),base+100); f.engine.tick(base+1100);
    f.engine.ingest(pc(51),base+3600000); f.engine.tick(base+3601000); assert.equal(f.notices.length,0);
    const full={Activity:{IsPresentationOrFullscreen:true}};
    f.engine.ingest(pc(52,full),base+3602000); f.engine.tick(base+3603000); assert.equal(f.notices.length,0);
    f.engine.ingest(pc(52),base+3604000); assert.equal(f.notices.length,1);
    f.engine.snooze(f.id,604800); f.engine.ingest(pc(53),base+3605000); f.engine.tick(base+3606000); assert.equal(f.notices.length,1);
    f.engine.snooze(f.id,0); f.engine.tick(base+3607000); assert.equal(f.notices.length,2);
  } finally { f.close(); }
});
test('change watches request file, network and disk collectors without threshold conditions', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'orvix-change-sensors-')), file=path.join(dir,'test.txt');
  const f=fixture(rule({trigger:{type:'change',watches:[{signal:'file_exists',target:file},{signal:'network_online'},{signal:'disk_free_percent',target:'C:'}],settleSeconds:0}}));
  let network=false, disk=50; const sensors=createTinyAgentSensors({listRules:()=>f.engine.list().rules,networkProbe:async()=>network,diskProbe:async()=>({'C:':disk}),onUpdate:s=>f.engine.ingestSensors(s,s.at)});
  try { await sensors.start(); assert.equal(f.notices.length,0); const start=Date.now(); for(let t=3000;t<=27000;t+=3000) await sensors.sample(start+t); fs.writeFileSync(file,'x'); network=true; disk=49; await sensors.sample(start+31000); assert.equal(f.notices.length,1); assert.match(f.notices[0].body,/File exists/); assert.match(f.notices[0].body,/Network reachable/); assert.match(f.notices[0].body,/Free disk space/); }
  finally { sensors.stop(); f.close(); fs.rmSync(dir,{recursive:true,force:true}); }
});
test('change validation rejects unsupported signals, duplicates, invalid sensitivity/actions/schedules', () => {
  assert.equal(validateRule(rule()).fireOnApproval,false);
  for (const extra of [ {trigger:{type:'change',watches:[],settleSeconds:1}}, {trigger:{type:'change',watches:[{signal:'always'}]}}, {trigger:{type:'change',watches:[{signal:'muted',direction:'increase'}]}}, {trigger:{type:'change',watches:[{signal:'brightness_percent',minDelta:0}]}}, {trigger:{type:'change',watches:[{signal:'brightness_percent'},{signal:'brightness_percent'}]}}, {action:{type:'shutdown'}}, {repeatSeconds:1}, {holdSeconds:1}, {schedule:{mode:'daily',start:'09:00'}} ]) assert.throws(()=>validateRule(rule(extra)));
});
test('shared model declarations and mapping can draft a change monitor without conditions', () => {
  const Module=require('node:module'), esbuild=require('esbuild');
  const built=esbuild.buildSync({entryPoints:['src/tinyAgentTools.ts'],bundle:true,platform:'node',format:'cjs',write:false});
  const m=new Module(__filename); m._compile(built.outputFiles[0].text,__filename);
  const trigger={type:'change',watches:[{signal:'brightness_percent',minDelta:1}],settleSeconds:1};
  const draft=m.exports.tinyAgentDraftFromModel({name:'Model change watch',trigger});
  const clean=validateRule(draft); assert.equal(clean.trigger.watches[0].signal,'brightness_percent'); assert.equal(clean.condition.signal,'always'); assert.equal(clean.action.type,'notify');
  const schema=require('../shared/tiny-agent-tools.json').functionDeclarations.find(t=>t.name==='draft_tiny_agent').parameters;
  assert.ok(schema.properties.trigger); assert.ok(!schema.required.includes('conditions'));
});
