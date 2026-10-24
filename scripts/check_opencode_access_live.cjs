// Explicit live diagnostic. Never logs credentials or changes a user project.
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
if(!process.argv.includes('--live'))throw Error('Pass --live to make the bounded provider access checks.');
const {runtimeBinary,isolatedEnvironment,createOpenCodeHeadless}=require('../electron/agent/opencode-headless.cjs');
const {createOpenCodeWorkers}=require('../electron/agent/opencode-workers.cjs');
const catalog=require('../electron/agent/opencode-catalog.cjs');
const model=require('../electron/agent/opencode-model.cjs');
const {readEnvValue}=require('../electron/agent/credentials.cjs');
const root=path.resolve('scratch/opencode-access-'+Date.now());fs.mkdirSync(root,{recursive:true});
const envText=fs.existsSync('.env')?fs.readFileSync('.env','utf8'):'';
const key=process.env.ORVIX_OPENCODE_ZEN_KEY?.trim()||readEnvValue(envText,'ORVIX_OPENCODE_ZEN_KEY');
const clean=value=>String(value??'').replaceAll(key||'\0','[redacted]').slice(-1800);
const modelId='opencode/deepseek-v4.1-flash-free';
const report={startedAt:new Date().toISOString(),runtimeVersion:require('opencode-ai/package.json').version,modelId,configuredKeyPresent:!!key,cases:[]};
const save=()=>fs.writeFileSync(path.join(root,'report.json'),JSON.stringify(report,null,2));
async function stock(auth){
 const work=path.join(root,'stock-'+auth);fs.mkdirSync(work,{recursive:true});
 const env=isolatedEnvironment(work,'unused-local-password');
 env.OPENCODE_CONFIG_CONTENT=JSON.stringify({share:'disabled',autoupdate:false,plugin:[],enabled_providers:['opencode']});
 if(auth==='configured')env.OPENCODE_API_KEY=key;
 const started=Date.now(),row={route:'stock-cli',auth};report.cases.push(row);save();console.log('START stock '+auth);
 await new Promise(resolve=>{let output='';const child=spawn(runtimeBinary(),['--pure','run','--format','json','--agent','build','--model',modelId,'--variant','high','Reply only OK. Do not use tools.'],{cwd:work,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  const timer=setTimeout(()=>{row.timedOut=true;child.kill();},60000);
  child.stdout.on('data',b=>{output=(output+b).slice(-16000);});child.stderr.on('data',b=>{output=(output+b).slice(-16000);});
  child.on('error',e=>{row.error=clean(e.message);});child.on('close',code=>{clearTimeout(timer);row.exitCode=code;row.output=clean(output);row.durationMs=Date.now()-started;save();console.log('END stock '+auth+' '+Math.round(row.durationMs/1000)+'s');resolve();});
 });
}
async function native(auth){
 const directory=path.join(root,'native-'+auth);fs.mkdirSync(directory,{recursive:true});
 const workers=createOpenCodeWorkers(directory,{getProviderKey:()=>auth==='configured'?key:''});
 catalog.configureOpenCodeCatalog(directory,workers);model.configureOpenCodeModel(workers);
 const row={route:'orvix-native',auth},started=Date.now();report.cases.push(row);save();console.log('START native '+auth);
 try{await catalog.refreshOpenCodeCatalog(true,AbortSignal.timeout(30000));
  const result=await model.runOpenCodeSession({taskId:'access-'+auth,modelId,variant:'high',directory,parts:[{type:'text',text:'Reply only OK. Do not use tools.'}],signal:AbortSignal.timeout(60000),timeoutMs:60000,onPermission:async()=>false});
  row.text=clean(result.text);row.success=!!result.text?.trim();
 }catch(error){row.error=clean(error.message);row.success=false;}finally{
  const authFile=path.join(directory,'opencode-workers',require('node:crypto').createHash('sha256').update('access-'+auth).digest('hex'),'opencode-headless/data/opencode/auth.json');
  try{row.nativeCredentialRemainsOnDisk=!!JSON.parse(fs.readFileSync(authFile,'utf8')).opencode;}catch{row.nativeCredentialRemainsOnDisk=false;}
  workers.shutdown();row.durationMs=Date.now()-started;save();console.log('END native '+auth+' '+Math.round(row.durationMs/1000)+'s');}
}
(async()=>{for(const auth of ['anonymous',...(key?['configured']:[])]){await stock(auth);await native(auth);}})().catch(error=>{report.error=clean(error.message);process.exitCode=1;}).finally(()=>{report.finishedAt=new Date().toISOString();save();console.log('REPORT '+path.join(root,'report.json'));});
