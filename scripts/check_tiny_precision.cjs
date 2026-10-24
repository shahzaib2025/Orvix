const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createTinyAgents, evaluate } = require('../electron/tiny-agents.cjs');
const { observe, validateChange, mergeChanges, formatChanges } = require('../electron/tiny-agent-changes.cjs');
const { createStagingCopy } = require('../electron/tiny-staging.cjs');
const at = Date.parse('2026-10-21T06:00:00Z');
const threshold = (value, comparator='gte') => ({ op:'predicate', signal:'cpu_percent', comparator, value });
test('rolling CPU changes do not starve when each reading is different; previews cannot consume samples', () => {
    const trigger = validateChange({ type:'change',settleSeconds:5,watches:[{signal:'cpu_percent',evaluation:'window',windowSeconds:6,minDelta:10}] }), states = new Map();
    const read = (value, offset) => observe(trigger,states,{at:at+offset,System:{cpu_percent:value}},at+offset);
    read(10,0); read(60,3000); read(70,6000); const result=read(80,9000);
    assert.equal(result.changes.length,1); assert.equal(result.changes[0].origin,'rolling_window'); assert.ok(result.changes[0].after >= 60);
    assert.equal(read(90,12000).changes.length,0);
});
test('stale network data stays stale when CPU updates, and excursion summaries retain the peak', () => {
    const snapshot={at:at+50000,System:{network_online:true,cpu_percent:50},Observations:{network_online:{at,status:'ready'},cpu_percent:{at:at+50000,status:'ready'}}};
    assert.equal(evaluate({op:'predicate',signal:'network_online',comparator:'eq',value:true},snapshot,at+50000),null);
    assert.equal(evaluate(threshold(40),snapshot,at+50000),true);
    const changes=mergeChanges([{signal:'brightness_percent',before:50,after:60,count:1}],[{signal:'brightness_percent',before:60,after:50,count:1}]);
    assert.equal(changes[0].max,60); assert.match(formatChanges(changes),/50% → 50%.*50%–60%/);
});
test('incident entry and recovery require sustained evidence; missing data never resolves it', () => {
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'orvix-precision-')), notices=[];
    const engine=createTinyAgents({getPath:()=>directory},{notify:(_title,body,meta)=>{notices.push({body,meta});return {status:'shown'};}});
    try {
        const id=engine.draft({name:'CPU incident',condition:threshold(80),holdSeconds:6,action:{type:'notify',message:'CPU'},incident:{recoveryCondition:threshold(60,'lte'),recoveryHoldSeconds:6,notifyRecovery:true}}).rule.id; engine.approve(id);
        const sample=(cpu,offset)=>engine.ingestSensors({at:at+offset,System:{cpu_percent:cpu}},at+offset);
        sample(85,0);sample(86,3000);assert.equal(notices.length,0);sample(87,6000);assert.equal(notices.length,1);
        const incident=engine.list().rules[0].incidentState.id;
        sample(null,9000);sample(50,12000);sample(null,15000);sample(50,18000);sample(50,21000);assert.equal(notices.length,1);sample(50,24000);
        assert.equal(notices.length,2);assert.match(notices[1].body,/Recovered/);assert.equal(notices[1].meta.incidentId,incident);
        sample(50,27000);assert.equal(notices.length,2);
    } finally {engine.stop();fs.rmSync(directory,{recursive:true,force:true});}
});
test('deferred alerts expire and retain a reviewable reason without displaying stale content', () => {
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'orvix-expiry-')), notices=[];
    const engine=createTinyAgents({getPath:()=>directory},{notify:(_title,body)=>{notices.push(body);return {status:'shown'};}});
    try {
        const id=engine.draft({name:'Expiry',condition:{op:'predicate',signal:'battery_percent',comparator:'lte',value:20},action:{type:'notify',message:'Low battery'},policy:{deferFullscreen:true,expiresAfterSeconds:5}}).rule.id;engine.approve(id);
        const sample=(battery,fullscreen,offset)=>engine.ingest({BatteryPercent:battery,Activity:{IsPresentationOrFullscreen:fullscreen}},at+offset);
        sample(50,true,0);sample(10,true,1000);sample(10,false,8000);
        assert.equal(notices.length,0);assert.ok(engine.list().history.some(event=>event.kind==='notification_expired'));
    } finally {engine.stop();fs.rmSync(directory,{recursive:true,force:true});}
});
test('staging verifies copies, preserves originals and refuses overlap, credentials and reused source names', async () => {
    // Workspace manager intentionally rejects protected OS/profile temporary paths.
    const directory=path.join(__dirname,'..','scratch','tiny-staging-test-'+require('node:crypto').randomUUID());
    fs.mkdirSync(directory,{recursive:true});const source=path.join(directory,'source'),destination=path.join(directory,'destination');fs.mkdirSync(source);fs.mkdirSync(destination);fs.writeFileSync(path.join(source,'report.txt'),'original');
    try {
        const result=await createStagingCopy({targets:[source],destination});assert.equal(result.status,'copy_verified');assert.equal(result.automaticPublish,false);
        fs.writeFileSync(path.join(result.directory,'source','report.txt'),'changed in copy');assert.equal(fs.readFileSync(path.join(source,'report.txt'),'utf8'),'original');
        await assert.rejects(createStagingCopy({targets:[source],destination:source}),/separate destination/);
        fs.writeFileSync(path.join(source,'.env'),'fixture');await assert.rejects(createStagingCopy({targets:[source],destination}),/credential/);
    } finally {assert.equal(path.dirname(path.resolve(directory)),path.resolve(__dirname,'..','scratch'));fs.rmSync(directory,{recursive:true,force:true});}
});
