const {test}=require('node:test'),assert=require('node:assert/strict'),Module=require('node:module'),path=require('node:path');
function load(file){const code=require('esbuild').buildSync({entryPoints:[path.join(__dirname,'../src',file)],bundle:true,platform:'node',format:'cjs',write:false,logLevel:'silent'}).outputFiles[0].text;const m=new Module(__filename,module);m.paths=module.paths;m._compile(code,__filename);return m.exports;}
const {buildPlan,planStatus,planSummary,planPrompt}=load('fastPlan.ts');
const ok=name=>({name,result:{status:'ok',stepCheck:{verified:true}}});
const bad=(name,status)=>({name,result:{status,stepCheck:{verified:false}}});

test('single-part and word-pair requests keep the existing loop',()=>{
  for(const t of ['weather in Rangpur','salt and pepper','hi','latest GPT models'])assert.equal(buildPlan(t),undefined,t);
});
test('mixed request splits into parts and routes chat parts separately',()=>{
  const plan=buildPlan('tell me a joke and then check the weather in Dhaka and search latest AI news');
  assert.equal(plan.length,3);
  assert.deepEqual(plan.map(p=>p.tools.length>0),[false,true,true]);
  assert.match(planPrompt(plan),/answer directly/);
});
test('plan ticks parts from verified receipts only, in order',()=>{
  const plan=buildPlan('weather in Dhaka and weather in Rangpur and search latest AI news');
  let s=planStatus(plan,[ok('get_weather')]);
  assert.deepEqual(s.pending.map(p=>p.index),[2,3]);
  s=planStatus(plan,[ok('get_weather'),ok('get_weather'),ok('web_search')]);
  assert.equal(s.complete,true);
});
test('blocked part does not hold back independent parts or completion',()=>{
  const plan=buildPlan('weather in Dhaka and search latest AI news');
  const s=planStatus(plan,[bad('get_weather','blocked'),ok('web_search')]);
  assert.equal(s.complete,true);
  assert.deepEqual(s.blocked.map(p=>p.index),[1]);
  assert.match(planSummary(plan,[bad('get_weather','blocked'),ok('web_search')]).instruction,/blocked part/);
});
test('unverified failure stays pending so the model retries or reports',()=>{
  const plan=buildPlan('weather in Dhaka and search latest AI news');
  const s=planStatus(plan,[bad('get_weather','failed'),ok('web_search')]);
  assert.deepEqual(s.pending.map(p=>p.index),[1]);
});

test('generic action and filename parts need real tool results',()=>{
  const p=buildPlan('open youtube and play a song then tell me a joke');
  assert.deepEqual(p.map(x=>x.tools.length>0),[true,true,false]);
  const f=buildPlan('list my desktop files and read notes.txt');
  assert.equal(f[1].tools.includes('read_file'),true);
  assert.equal(planStatus(f,[ok('list_directory')]).pending.length,1);
  const g=buildPlan('weather in Dhaka and play a song');
  assert.equal(planStatus(g,[ok('get_weather')]).pending.map(x=>x.index).join(),'2');
});
