const {app,safeStorage}=require('electron');const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createCredentials}=require('../electron/agent/credentials.cjs');
const {configureKiloCatalog,refreshKiloCatalog}=require('../electron/agent/kilo-catalog.cjs');
const {request,appendResult}=require('../electron/agent/model-client.cjs');
const {redactApiKeys}=require('../electron/agent/api-key-check.cjs');
app.setName('Orvix');app.setPath('userData',path.join(process.env.APPDATA,'Orvix'));
const root=fs.mkdtempSync(path.resolve('scratch','kilo-free-diagnostic-'));const report={at:new Date().toISOString(),root,cases:[]};
const writeProgress=value=>fs.appendFileSync(path.join(root,'progress.log'),String(value)+'\n');
const save=()=>fs.writeFileSync(path.join(root,'result.json'),JSON.stringify(report,null,2));
app.whenReady().then(async()=>{
const credentials=createCredentials(app,safeStorage),key=credentials.getKey('kilo');report.keyConfigured=Boolean(key);
const safe=error=>redactApiKeys(String(error?.message||error)).replaceAll(key||'NO_SAVED_KEY','[redacted]');
configureKiloCatalog(root,()=>key);const catalog=await refreshKiloCatalog(true);if(catalog.error)throw Error(catalog.error);
const models=catalog.models.filter(m=>m.access==='free'&&!/gpt/i.test(m.apiModelId+' '+m.name));report.models=models.map(m=>({id:m.id,name:m.name,variants:m.variants,input:m.input}));save();writeProgress(JSON.stringify({root,keyConfigured:Boolean(key),models:report.models}));
if(!key){report.error='No saved Kilo key available; generation not tested.';save();return;}
for(const model of models){
const test={id:model.id,name:model.name};const opts={modelId:model.id,key,sessionId:'kilo-free-diagnostic-'+Date.now(),signal:AbortSignal.timeout(45000),timeoutMs:45000,accessMode:'Plan',purpose:'conversation',onDelta:()=>{}};
writeProgress('START '+model.id);let start=Date.now();
try{const r=await request({...opts,history:[{role:'user',content:'Reply with exactly OK.'}],tools:[]});test.response={status:r.text?.trim()?'passed':'no_text',text:r.text.slice(0,200),durationMs:Date.now()-start};}catch(e){test.response={status:'failed',error:safe(e),durationMs:Date.now()-start};}
start=Date.now();const history=[{role:'user',content:'Call sum_numbers with a=2 and b=3, then report the tool result. You must use the tool.'}];
const tool={name:'sum_numbers',description:'Adds two numbers.',parameters:{type:'object',properties:{a:{type:'number'},b:{type:'number'}},required:['a','b'],additionalProperties:false}};
try{const first=await request({...opts,signal:AbortSignal.timeout(45000),history,tools:[tool]});const call=first.calls.find(c=>c.name==='sum_numbers');if(!call)throw Error('No sum_numbers call returned.');const args=typeof call.args==='string'?JSON.parse(call.args):call.args;if(args.a!==2||args.b!==3)throw Error('Incorrect tool arguments.');appendResult(first.route,history,first,[{id:call.id,text:'5'}]);const second=await request({...opts,signal:AbortSignal.timeout(45000),history,tools:[tool]});test.tool={status:/\b5\b/.test(second.text)?'passed':'incorrect_result',text:second.text.slice(0,200),durationMs:Date.now()-start};}catch(e){test.tool={status:'failed',error:safe(e),durationMs:Date.now()-start};}
report.cases.push(test);save();writeProgress(JSON.stringify(test));
await new Promise(resolve=>setTimeout(resolve,1500));
}
}).catch(e=>{report.error=redactApiKeys(e.message);save();writeProgress(report.error);}).finally(()=>{save();app.quit();});
