// Isolated V2 contract evaluation. Does not replace the production runtime.
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
if(!process.argv.includes('--live'))throw Error('Pass --live for the bounded V2 compatibility check.');
if(!process.argv.includes('--worker')){
 const root=path.resolve('scratch/opencode-v2-compat-'+Date.now());fs.mkdirSync(root,{recursive:true});
 const {isolatedEnvironment}=require('../electron/agent/opencode-headless.cjs');
 const env=isolatedEnvironment(root,require('node:crypto').randomBytes(32).toString('hex'));
 env.OPENCODE_CONFIG_CONTENT=JSON.stringify({update:'disable',share:'disabled',snapshots:false,plugins:[],permissions:[{action:'*',resource:'*',effect:'ask'}],agents:{title:{disabled:true},summary:{disabled:true}}});
 const child=spawn(process.execPath,[__filename,'--live','--worker',root],{cwd:path.resolve('.'),env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);
 const timer=setTimeout(()=>{child.kill();console.log('V2 diagnostic exceeded its 150-second limit; inspect its isolated service before reuse.');},150000);
 child.on('close',code=>{clearTimeout(timer);process.exitCode=code;});
}else{
 // The CLI publishes at XDG_STATE_HOME/opencode/service.json. Service.ensure's
 // `file` option selects discovery; it does not relocate the CLI's registration.
 const root=process.argv.at(-1),serviceFile=path.join(root,'state','opencode','service.json');
 const stage=path.resolve('scratch/opencode-v2-evaluation/node_modules/@opencode');
 const {readEnvValue}=require('../electron/agent/credentials.cjs');
 const key=readEnvValue(fs.readFileSync('.env','utf8'),'ORVIX_OPENCODE_ZEN_KEY');
 const redact=value=>String(value??'').replaceAll(key||'\0','[redacted]').slice(0,1600);
 const report={startedAt:new Date().toISOString(),scope:'Staged V2 client/server contract check; production remains on V1.'};
 let Service,client;
 (async()=>{
  ({Service}=await import(require('node:url').pathToFileURL(path.join(stage,'client/dist/promise/service.js')).href));
  const {OpenCode}=await import(require('node:url').pathToFileURL(path.join(stage,'client/dist/promise/index.js')).href);
  const endpoint=await Service.ensure({file:serviceFile,version:'2.0.32',command:[path.join(stage,'cli-windows-x64/bin/opencode.exe'),'serve','--service']});
  client=OpenCode.make({baseUrl:endpoint.url,headers:Service.headers(endpoint)});
  report.serverVersion=(await client.server.info()).version;
  const integrations=await client.integration.list({location:{directory:root}});
  report.integrationShape=Object.keys(integrations);report.opencodeAvailable=(integrations.data??integrations).some?.(x=>x.id==='opencode');
  if(key){await client.integration.connect.key({integrationID:'opencode',key,location:{directory:root}});report.keyConnected=true;}
  const session=await client.session.create({location:{directory:root},agent:'build',model:{providerID:'opencode',id:'deepseek-v4.1-flash-free',variant:'high'},permissions:[{action:'*',resource:'*',effect:'ask'}]});
  report.sessionCreated=!!session.id;
  await client.session.prompt({sessionID:session.id,text:'Reply only OK. Do not use tools.'});
  await client.session.wait({sessionID:session.id},{signal:AbortSignal.timeout(60000)});
  const completed=await client.session.get({sessionID:session.id});report.outcome=completed.outcome;
  report.messageShape=Object.keys(await client.message.list({sessionID:session.id}));
  report.passed=completed.outcome==='succeeded';
 })().catch(error=>{report.passed=false;report.error=redact(error.message);process.exitCode=1;}).finally(async()=>{
  if(client)try{const entries=await client.credential.list();for(const entry of entries)await client.credential.remove({credentialID:entry.id});report.credentialsCleared=true;}catch(error){report.cleanupError=redact(error.message);}
  if(Service)try{await Service.stop({file:serviceFile});report.serviceStopped=true;}catch(error){report.stopError=redact(error.message);}
  report.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({report:path.join(root,'report.json'),...report}));
 });
}
