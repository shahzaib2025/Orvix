const fs=require('node:fs'),path=require('node:path');
const {createOpenCodeHeadless}=require('../electron/agent/opencode-headless.cjs');
const {configureOpenCodeCatalog,refreshOpenCodeCatalog}=require('../electron/agent/opencode-catalog.cjs');
const {configureOpenCodeModel,runOpenCodeSession}=require('../electron/agent/opencode-model.cjs');
const {redactApiKeys}=require('../electron/agent/api-key-check.cjs');
const root=path.resolve(process.argv[2] || 'scratch/opencode-all-models-0jTQDj'),report=JSON.parse(fs.readFileSync(path.join(root,'result.json')));
const fixture=path.join(root,'read-fixture');fs.mkdirSync(fixture,{recursive:true});
const file=path.join(fixture,'marker.txt');fs.writeFileSync(file,'ORVIX_READ_CHECK_51928');
const runtime=createOpenCodeHeadless(root);report.toolCases=[];
const save=()=>fs.writeFileSync(path.join(root,'result.json'),JSON.stringify(report,null,2));
(async()=>{configureOpenCodeCatalog(root,runtime);configureOpenCodeModel(runtime);await refreshOpenCodeCatalog(false,AbortSignal.timeout(30000));
for(const entry of report.cases.filter(x=>x.status==='passed' && (!process.argv[3] || x.id===process.argv[3]))){
console.log('READ '+entry.id);const start=Date.now(),tools=[],retries=[];
try{const result=await runOpenCodeSession({modelId:entry.id,directory:fixture,parts:[{type:'text',text:'Use the native read tool to read '+file+'. Reply with its exact contents. Do not use shell or any other tools. Do not edit anything.'}],timeoutMs:60000,onPermission:p=>p.permission==='read'&& (p.patterns||[]).every(x=>(path.resolve(fixture,x).toLowerCase()===file.toLowerCase() || path.resolve(path.parse(file).root,x).toLowerCase()===file.toLowerCase())),onEvent:event=>{const p=event.properties?.part;if(p?.type==='tool'&&['completed','error'].includes(p.state?.status))tools.push({tool:p.tool,status:p.state.status,error:p.state.error});if(event.properties?.status?.type==='retry')retries.push(redactApiKeys(String(event.properties.status.message||'')));}});
report.toolCases.push({id:entry.id,status:tools.some(t=>t.tool==='read'&&t.status==='completed')&&result.text.includes('ORVIX_READ_CHECK_51928')?'passed':'unverified',text:result.text.slice(0,200),tools,durationMs:Date.now()-start,retries});
}catch(e){report.toolCases.push({id:entry.id,status:'failed',error:redactApiKeys(e.message),tools,durationMs:Date.now()-start,retries});}save();console.log(JSON.stringify(report.toolCases.at(-1)));
}
})().catch(e=>console.log(redactApiKeys(e.message))).finally(()=>runtime.shutdown());
