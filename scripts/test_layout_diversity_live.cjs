// Live generation controls. Each phase freezes source, each run gets a fresh
// worker/session/workspace, and results are evidence rather than quality grades.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const option = (name, fallback) => process.argv.slice(2).find(value => value.startsWith('--' + name + '='))?.slice(name.length + 3) ?? fallback;
const phase = option('phase', 'baseline');
const lanes = option('lanes', 'raw,none,max').split(',');
const repeats = Number(option('repeats', '2'));
const minutes = Number(option('minutes', '15'));
if (!Number.isFinite(minutes) || minutes < 3 || minutes > 25) throw Error('Use a bounded 3–25 minute experiment.');
if (!/^[a-z][a-z0-9-]{0,40}$/.test(phase) || !lanes.every(value => ['raw','none','normal','medium','max'].includes(value)) || !Number.isInteger(repeats) || repeats < 1 || repeats > 2) throw Error('Invalid comparison options.');
const modelId = option('model', 'opencode/muse-spark-1.3-contributor-free');
const variant = option('variant', 'xhigh') || undefined;
const historyMode = option('history', 'shared');
const priorReports = process.argv.slice(2).filter(value=>value.startsWith('--prior-report=')).map(value=>value.slice('--prior-report='.length));
if (!['shared','isolated'].includes(historyMode)) throw Error('Invalid history control.');
const stamp = Date.now();
const stateRoot = path.resolve('scratch/layout-diversity-' + phase + '-' + stamp);
const output = path.join(process.env.USERPROFILE, 'Desktop', 'Orvix-Layout-Diversity-' + phase + '-' + stamp);
fs.mkdirSync(stateRoot, {recursive:true}); fs.mkdirSync(output);
const source = path.join(stateRoot, 'snapshot', 'electron');
fs.cpSync(path.resolve('electron'), source, {recursive:true});
fs.cpSync(path.resolve('shared'), path.join(stateRoot,'snapshot','shared'), {recursive:true});
const {createOpenCodeWorkers} = require(path.join(source,'agent/opencode-workers.cjs'));
const catalogAPI = require(path.join(source,'agent/opencode-catalog.cjs'));
const modelAPI = require(path.join(source,'agent/opencode-model.cjs'));
const {createAgentEngine} = require(path.join(source,'agent/engine.cjs'));
const {readEnvValue} = require(path.join(source,'agent/credentials.cjs'));
const envText = fs.existsSync('.env') ? fs.readFileSync('.env','utf8') : '';
const providerKey = process.env.ORVIX_OPENCODE_ZEN_KEY?.trim() || readEnvValue(envText,'ORVIX_OPENCODE_ZEN_KEY');
// Match the app's official auth handoff. Never place credentials in prompts,
// child environment overrides, trace metadata or generated website files.
const runtime = createOpenCodeWorkers(path.join(stateRoot,'runtime'), {getProviderKey:()=>providerKey});
catalogAPI.configureOpenCodeCatalog(stateRoot,runtime); modelAPI.configureOpenCodeModel(runtime);
const brief = 'Create a complete premium website for Signaldesk, a fictional developer incident-diagnosis product for engineering teams. Communicate the product, its workflow, pricing information and a working local demo-request interaction. Invent the art direction, page composition, visual explanations, typography and appropriate motion yourself. The requested content does not prescribe section order, card grids, columns or a hero arrangement. Use a coherent light theme. Do not invent customer logos, testimonials, performance statistics or endorsements. Label any illustrative product examples and pricing honestly. Use real suitable images by direct URL when they help; do not download or generate photographs. Build with plain HTML/CSS/JavaScript, index.html as the entry, and versioned CDN libraries when needed. Use the available preview tools to inspect desktop/mobile and the primary action within their existing allowance. Deliver working code, not a proposal.';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const report = {phase,output,stateRoot,modelId,variant,historyMode,brief,briefHash:hash(brief),startedAt:new Date().toISOString(),
  controls:'Same user brief, provider/model ID, reasoning level, isolated runtime and workspace policy. Raw strips Orvix text/system guidance while retaining the same permission and preview bridge. Profile-owned skills/workflows are the treatment. Provider sampling remains uncontrolled.',
  skillHashes:Object.fromEntries(['website_design','website_design_medium','website_design_max','visual_composition'].map(name=>[name,hash(fs.readFileSync(path.join(source,'agent/skills',name,'SKILL.md')))])),runs:[]};
const save = () => { fs.writeFileSync(path.join(stateRoot,'report.json'),JSON.stringify(report,null,2)); fs.writeFileSync(path.join(output,'generation-report.json'),JSON.stringify(report,null,2)); };
let engine, activeTask, timer;
process.on('SIGINT',()=>engine?.cancel(activeTask)); process.on('SIGTERM',()=>engine?.cancel(activeTask));
save(); console.log('OUTPUT ' + output);
(async()=>{
  const catalog = await catalogAPI.refreshOpenCodeCatalog(true,AbortSignal.timeout(60000));
  const model = catalog.models.find(item=>item.id===modelId);
  if (catalog.error || catalog.stale || !model || !(variant ? model.variants.includes(variant) : model.variants.length === 0)) throw Error('Exact model/reasoning unavailable; no fallback.');
  report.catalogModel=model; save();
  for(const priorReport of priorReports){
    const previous=JSON.parse(fs.readFileSync(priorReport,'utf8'));
    const {createTaskMemoryStore}=require(path.join(source,'agent/task-memory-store.cjs'));
    const store=createTaskMemoryStore({getPath:()=>path.join(stateRoot,'engines','shared')});
    const seeded=[];
    const previousStore=createTaskMemoryStore({getPath:()=>path.join(previous.stateRoot,'engines',previous.historyMode==='shared'?'shared':previous.runs?.at(-1)?.label??'unknown')});
    const eligible=new Set(previousStore.recentDesigns('new-layout-control',8).map(note=>note.taskId));
    for(const row of previous.runs??[]){const saved=previousStore.read(row.taskId);
      const design=row.verification?.designReview??saved?.designReview,observed=row.observedComposition??design?.observedComposition;
      if(!eligible.has(row.taskId)||!design?.brief||!observed||observed.fingerprint!==design.sourceFingerprint)continue;
      const id='comparison-'+crypto.randomUUID();
      store.write(id,{status:saved?.status==='stopped'||saved?.status==='failed'?saved.status:'completed',changedFiles:['sanitized-comparison-note'],designReview:{brief:design.brief,sourceFingerprint:observed.fingerprint,observedComposition:observed}});
      seeded.push({taskId:id,label:row.label,originalStatus:saved?.status??row.status});
    }
    report.seededComparisonNotes=[...(report.seededComparisonNotes??[]),...seeded];save();
  }
  runs: for (let repeat=1;repeat<=repeats;repeat++) for (const lane of lanes) {
    const label=lane+'-'+repeat, project=path.join(output,label); fs.mkdirSync(project);
    const taskId='layout-'+crypto.randomUUID(); activeTask=taskId;
    const prompt=brief+'\nBuild in this new approved folder: '+project+'. Do not read unrelated projects.';
    const run={label,lane,repeat,project,taskId,status:'building',startedAt:new Date().toISOString(),events:[],traces:[]};report.runs.push(run);save();
    const started=Date.now(); let effectivePrompt, failureSince=0, providerFailures=0;
    engine=createAgentEngine({getPath:()=>path.join(stateRoot,'engines',historyMode==='shared'?'shared':label),getVersion:()=> 'layout-diversity-control'}, {getKey:()=>''}, event=>{
      if (['tool','activity'].includes(event.type)) {
        run.events.push({atMs:Date.now()-started,type:event.type,name:event.name,phase:event.phase,failed:event.failed,message:event.message,detail:event.detail,input:event.input,output:event.output?.slice(0,1200)});
        save(); if(event.phase==='completed'||event.type==='activity') console.log(label+' '+Math.round((Date.now()-started)/1000)+'s '+(event.name??event.message)+(event.failed?' FAILED':''));
        if(event.type==='tool'&&event.phase==='completed'&&!event.failed){providerFailures=0;failureSince=0;}
        if(event.type==='activity'&&/provider request failed|Temporary provider failure/i.test(event.message??'')){
          providerFailures++;failureSince ||= Date.now();
          if(providerFailures>=3&&Date.now()-failureSince>60000){run.interruption='Repeated provider connection failures without tool progress; stopped this experiment with source retained.';engine.cancel(taskId);}
        }
      }
      if(event.type==='approval')engine.decide(event.approvalId,false);
      if(event.type==='question'){run.question=event.question;engine.cancel(taskId);}
    },null,{runNativeSession:async options=>{
      const actual=lane==='raw'?{...options,systemPrompt:undefined,parts:[{type:'text',text:prompt}]}:options;
      if(!effectivePrompt){effectivePrompt={systemPrompt:actual.systemPrompt??null,parts:actual.parts};fs.writeFileSync(path.join(stateRoot,label+'-delivered-prompt.json'),JSON.stringify(effectivePrompt,null,2));}
      return modelAPI.runOpenCodeSession({...actual,onRequest:async trace=>{run.traces.push(trace);save();await options.onRequest?.(trace);}});
    }});
    console.log('START '+label);
    try {
      await engine.workspaces.open(taskId,project,async()=>true);
      timer=setTimeout(()=>{run.diagnosticTimedOut=true;run.interruption='Diagnostic time budget reached ('+minutes+' minutes); source retained. This is not a production task limit.';save();engine.cancel(taskId);},minutes*60000);
      const result=await engine.run({taskId,requestId:'build',modelId,thinkingVariant:variant,designProfile:lane==='raw'?'none':lane,designReviewMode:'fast',accessMode:'Full access',accessModeVersion:2,messages:[{role:'user',content:prompt}]});
      run.status='returned';run.reply=result.text;run.verification=result.verification;run.usage=result.usage;run.changedFiles=result.changes.map(item=>item.path);
      const memory=engine.taskMemory.read(taskId);run.observedComposition=memory?.designReview?.observedComposition;
      run.hasEntrypoint=fs.existsSync(path.join(project,'index.html'));
    } catch(error) {run.status='failed';run.error=error.message;}
    finally {clearTimeout(timer);run.durationMs=Date.now()-started;run.finishedAt=new Date().toISOString();engine.shutdown();engine=null;runtime.forTask(taskId).shutdown();save();}
    console.log('END '+label+' '+run.status+' '+Math.round(run.durationMs/1000)+'s');
    if(run.status==='failed'||!run.hasEntrypoint){report.stopReason=run.interruption??'Generation failed or returned no entrypoint; inspect the recorded failure before further live runs.';break runs;}
  }
})().catch(error=>{report.error=error.message;process.exitCode=1;}).finally(()=>{clearTimeout(timer);engine?.shutdown();runtime.shutdown();report.finishedAt=new Date().toISOString();save();console.log('REPORT '+path.join(output,'generation-report.json'));});
