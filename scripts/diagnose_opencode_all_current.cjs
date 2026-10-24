const fs=require('node:fs'),path=require('node:path');
const {createOpenCodeHeadless}=require('../electron/agent/opencode-headless.cjs');
const {configureOpenCodeCatalog,refreshOpenCodeCatalog}=require('../electron/agent/opencode-catalog.cjs');
const {configureOpenCodeModel,runOpenCodeSession}=require('../electron/agent/opencode-model.cjs');
const {redactApiKeys}=require('../electron/agent/api-key-check.cjs');
const root=fs.mkdtempSync(path.resolve('scratch','opencode-all-models-'));
const runtime=createOpenCodeHeadless(root),report={at:new Date().toISOString(),root,cases:[]};
const save=()=>fs.writeFileSync(path.join(root,'result.json'),JSON.stringify(report,null,2));
(async()=>{
configureOpenCodeCatalog(root,runtime);configureOpenCodeModel(runtime);
const catalog=await refreshOpenCodeCatalog(true,AbortSignal.timeout(45000));
if(catalog.error||catalog.stale)throw Error(catalog.error||'Stale catalog');
report.models=catalog.models;report.excluded=catalog.excluded;save();
console.log(JSON.stringify({root,models:catalog.models.map(m=>({id:m.id,variants:m.variants})),excluded:catalog.excluded}));
for(const model of catalog.models){
const started=Date.now(),retries=[];console.log('START '+model.id);
try{const reply=await runOpenCodeSession({modelId:model.id,readOnly:true,parts:[{type:'text',text:'Reply with the single word OK. Do not use tools.'}],timeoutMs:45000,onEvent:event=>{if(event.type==='session.status'&&event.properties?.status?.type==='retry')retries.push({attempt:event.properties.status.attempt,message:redactApiKeys(String(event.properties.status.message||''))});}});
report.cases.push({id:model.id,status:'passed',text:reply.text.slice(0,200),durationMs:Date.now()-started,retries});
}catch(error){report.cases.push({id:model.id,status:'failed',error:redactApiKeys(error.message),durationMs:Date.now()-started,retries});}
save();console.log(JSON.stringify(report.cases.at(-1)));
}
})().catch(error=>{report.error=redactApiKeys(error.message);save();console.log(report.error);process.exitCode=1;}).finally(()=>runtime.shutdown());
