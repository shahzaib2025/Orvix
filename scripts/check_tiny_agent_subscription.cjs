const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const esbuild = require('esbuild');
const compiled = esbuild.buildSync({ entryPoints:['src/tinyAgentSubscription.ts'], bundle:true,platform:'node',format:'cjs',write:false });
const loaded = new Module(__filename); loaded._compile(compiled.outputFiles[0].text,__filename);
const { subscribeTinyAgentListing } = loaded.exports;
const listing = name => ({rules:[],history:[{id:name,kind:'notification_shown'}],shutdownPending:null});

test('pushed update arrives immediately and late initial read cannot overwrite it', async () => {
  let event, resolveInitial, requests=0;
  const values=[];
  const bridge={onTinyAgentEvent:fn=>{event=fn;return ()=>{};},listTinyAgents:()=>{requests++;return new Promise(r=>resolveInitial=r);}};
  const off=subscribeTinyAgentListing(bridge,v=>values.push(v));
  event({kind:'notification_queued',listing:listing('new')});
  assert.equal(values[0].history[0].id,'new'); assert.equal(requests,1);
  resolveInitial(listing('old')); await Promise.resolve();
  assert.equal(values.length,1); off();
});
test('monitor snapshots do not trigger repeated reads and unmounted subscribers ignore replies', async () => {
  let event, resolveInitial, requests=0, updates=0;
  const bridge={onTinyAgentEvent:fn=>{event=fn;return ()=>{};},listTinyAgents:()=>{requests++;return new Promise(r=>resolveInitial=r);}};
  const off=subscribeTinyAgentListing(bridge,()=>updates++);
  for(let i=0;i<100;i++) event({kind:'snapshot'});
  assert.equal(requests,1); off(); resolveInitial(listing('late')); await Promise.resolve(); assert.equal(updates,0);
});
