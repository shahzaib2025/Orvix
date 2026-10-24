const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const {createOpenCodeHeadless}=require('../electron/agent/opencode-headless.cjs');
const {configureOpenCodeCatalog,refreshOpenCodeCatalog}=require('../electron/agent/opencode-catalog.cjs');
const {configureOpenCodeModel,runOpenCodeSession}=require('../electron/agent/opencode-model.cjs');
const root=fs.mkdtempSync(path.resolve('scratch','muse12-native-probe-'));
const runtime=createOpenCodeHeadless(root,{spawn:(binary,args,options)=>{
const config=JSON.parse(options.env.OPENCODE_CONFIG_CONTENT);
config.provider={opencode:{models:{'muse-spark-1.2-contributor-free':{name:'Muse Spark 1.2 Contributor Free',tool_call:true,reasoning:true,modalities:{input:['text'],output:['text']},cost:{input:0,output:0},provider:{npm:'@ai-sdk/openai',api:'https://opencode.ai/zen/v1'}}}}};
options.env.OPENCODE_CONFIG_CONTENT=JSON.stringify(config);return cp.spawn(binary,args.filter(arg=>arg!=='--pure'),options);}});
const report={root,scope:'Diagnostic model registration only; no production catalog override.'};
(async()=>{configureOpenCodeCatalog(root,runtime);configureOpenCodeModel(runtime);const c=await refreshOpenCodeCatalog(true,AbortSignal.timeout(30000));if(c.error)throw Error(c.error);
const provider=await runtime.exclusive(null,({api})=>api('/provider'));const model=provider.all.find(p=>p.id==='opencode').models['muse-spark-1.2-contributor-free'];console.log(JSON.stringify({metadata:model??null}));
console.log(JSON.stringify({root,available:c.models.some(m=>m.id==='opencode/muse-spark-1.2-contributor-free')}));
if(!c.models.some(m=>m.id==='opencode/muse-spark-1.2-contributor-free')) {
const raw=await runtime.exclusive(null,async({api,workdir})=>{const session=await api('/session',{method:'POST',body:{permission:[{permission:'*',pattern:'*',action:'deny'}]}});try{return await api('/session/'+session.id+'/message',{method:'POST',timeoutMs:45000,body:{model:{providerID:'opencode',modelID:'muse-spark-1.2-contributor-free'},agent:'build',parts:[{type:'text',text:'Reply with OK. Do not use tools.'}]}});}finally{await api('/session/'+session.id,{method:'DELETE'});}});report.rawError=raw.info?.error;report.rawText=raw.parts?.filter(p=>p.type==='text').map(p=>p.text);console.log(JSON.stringify({error:report.rawError,text:report.rawText}));return;}
const r=await runOpenCodeSession({modelId:'opencode/muse-spark-1.2-contributor-free',readOnly:true,timeoutMs:45000,parts:[{type:'text',text:'Reply with exactly OK. Do not use tools.'}],onEvent:e=>{if(e.properties?.status?.type==='retry')console.log(JSON.stringify(e.properties.status));}});report.text=r.text;console.log(r.text);
})().catch(e=>{report.error=e.message;console.log(e.message);}).finally(()=>{runtime.shutdown();fs.writeFileSync(path.join(root,'result.json'),JSON.stringify(report,null,2));});
