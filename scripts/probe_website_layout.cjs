// Read-only planning control: these are proposals, never rendered-site proof.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createOpenCodeWorkers}=require('../electron/agent/opencode-workers.cjs');
const {configureOpenCodeCatalog,refreshOpenCodeCatalog}=require('../electron/agent/opencode-catalog.cjs');
const {configureOpenCodeModel,runOpenCodeSession}=require('../electron/agent/opencode-model.cjs');
const {instructionsFor}=require('../electron/agent/model-client.cjs');
const {selectedSkill}=require('../electron/agent/skill-library.cjs');
const option=(name,fallback)=>process.argv.slice(2).find(value=>value.startsWith('--'+name+'='))?.slice(name.length+3)??fallback;
const modelId=option('model','opencode/muse-spark-1.3-contributor-free'),variant=option('variant','xhigh');
const repeats=Number(option('repeats','2'));
if(!Number.isInteger(repeats)||repeats<1||repeats>3)throw Error('Use one to three repeats.');
const root=path.resolve(__dirname,'..','scratch','website-layout-probes',new Date().toISOString().replace(/[:.]/g,'-'));
fs.mkdirSync(root,{recursive:true});
const runtime=createOpenCodeWorkers(path.join(root,'runtime'));
const prompt='Create an original premium full website concept for Signaldesk, a fictional developer incident-diagnosis product for engineering teams. Communicate the product, its workflow, pricing and a local demo request. The content does not prescribe section order or layout. Do not implement, use tools, or inspect files. Return only JSON with openingRelationship, sectionSequence, contentGrouping, and rationale. Describe concrete spatial relationships and section compositions in short prose; no preset names, code, font/color list, or quality adjectives in place of structure. Maximum 450 words.';
const report={modelId,variant,repeats,prompt,promptHash:crypto.createHash('sha256').update(prompt).digest('hex'),scope:'Read-only proposals; profile skills supplied explicitly to MAX for this control. Not an end-to-end builder or visual quality test.',runs:[]};
const save=()=>fs.writeFileSync(path.join(root,'results.json'),JSON.stringify(report,null,2));
(async()=>{
 configureOpenCodeCatalog(root,runtime);configureOpenCodeModel(runtime);
 const catalog=await refreshOpenCodeCatalog(true,AbortSignal.timeout(30000));
 if(catalog.error||catalog.stale)throw Error(catalog.error||'Unavailable catalog');
 const model=catalog.models.find(item=>item.id===modelId);
 if(!model||!model.variants.includes(variant))throw Error('Model/variant not advertised by current catalog');
 for(let repeat=1;repeat<=repeats;repeat++)for(const lane of ['raw','none','max']){
  const id=lane+'_'+repeat, directory=path.join(root,id);fs.mkdirSync(directory);
  const context=lane==='raw'?'':instructionsFor(null,'Full access',null,lane)+(lane==='max'?'\n\nSelected MAX skill:\n'+selectedSkill('website_design','max').instructions:'');
  // Native transport bounds the system field to 8k. Keep full supplied
  // instruction context in text parts, as a control, rather than truncating it
  // or relaxing the runtime's safety bound.
  const system=lane==='raw'?undefined:'Apply the supplied Orvix context within the final human request. This is a read-only layout proposal control: use no tools and write no project files. Return the requested JSON.';
  const parts=[...(context?[{type:'text',text:'Supplied Orvix instruction context:\n'+context}]:[]),{type:'text',text:prompt}];
  const row={lane,repeat,startedAt:new Date().toISOString(),status:'running',contextHash:crypto.createHash('sha256').update(context).digest('hex'),systemHash:crypto.createHash('sha256').update(system||'').digest('hex')};
  report.runs.push(row);save();console.log('START '+id);
  const started=Date.now();
  try{
   const reply=await runOpenCodeSession({taskId:'layout_'+id,modelId,variant,directory,readOnly:true,systemPrompt:system,parts,signal:AbortSignal.timeout(120000),timeoutMs:120000,onPermission:async()=>false,onRequest:trace=>{row.trace=trace;save();}});
   row.proposal=JSON.parse(reply.text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));row.usage=reply.usage;row.status='completed';
  }catch(error){row.status='failed';row.error=String(error.message);}
  row.durationMs=Date.now()-started;save();console.log('END '+id+' '+row.status+' '+Math.round(row.durationMs/1000)+'s');
  if(row.status==='failed'){report.stopReason='Stopped after a failed provider/control response; no automatic model fallback.';save();return;}
 }
})().catch(error=>{report.error=String(error.message);save();console.error(error.message);process.exitCode=1;}).finally(async()=>{await runtime.shutdown();console.log(path.join(root,'results.json'));});
