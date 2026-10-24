// Planning-only provider exercise through Orvix's managed skill loader and native
// OpenCode transport. No website task or execution tools are authorized.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createOpenCodeHeadless}=require('../electron/agent/opencode-headless.cjs');
const {configureOpenCodeCatalog,refreshOpenCodeCatalog}=require('../electron/agent/opencode-catalog.cjs');
const {configureOpenCodeModel,runOpenCodeSession}=require('../electron/agent/opencode-model.cjs');
const skills=require('../electron/agent/skill-library.cjs');
const {selectTaskSkills}=require('../electron/agent/task-skill-router.cjs');
const {createSkillPolicy}=require('../electron/agent/skill-policy.cjs');
const root=path.resolve('scratch/layout-options-live-'+Date.now());fs.mkdirSync(root,{recursive:true});
const modelId=process.argv[2]||'opencode/space-bunny-free';
const runtime=createOpenCodeHeadless(path.join(root,'runtime'));
configureOpenCodeCatalog(root,runtime);configureOpenCodeModel(runtime);
const report={root,modelId,scope:'Managed skill + native model transport, planning-only; not a full engine/UI build test.',runs:[]};
const save=()=>fs.writeFileSync(path.join(root,'report.json'),JSON.stringify(report,null,2));
(async()=>{try{
  const catalog=await refreshOpenCodeCatalog(true,AbortSignal.timeout(60000));
  if(catalog.error||catalog.stale)throw Error(catalog.error||'Stale model catalog');
  const model=catalog.models.find(m=>m.id===modelId);if(!model)throw Error('Requested model unavailable; no silent substitution');
  report.variant=model.variants.includes('xhigh')?'xhigh':undefined;save();
  for(const [label,subject]of [
    ['architecture','a fictional architecture and adaptive-reuse studio, black theme, professional and visually ambitious'],
    ['greetings','FlorianBD, a fictional greeting-card and personal-message shop, white theme, professional and visually ambitious'],
  ]){
    const request=`Develop two website layout options for ${subject}. Use Design MAX ambition for a full site. Choose the stronger option and detail its complete layout. Only provide the options and plan in chat; do not build a website, create project files, use tools, or inspect any existing project. Invent the art direction yourself. Do not invent factual business proof. Keep the complete response within 1,800 words and finish every section.`;
    const policy=createSkillPolicy('max',request);
    const routed=selectTaskSkills(request,{designProfile:'max',policy});
    if(!routed.some(s=>s.id==='website_layout_options'))throw Error('Options skill was not routed');
    const loaded=skills.selectedSkills({designProfile:'max',policy}).filter(s=>['website_layout_options','visual_composition','website_design_max'].includes(s.id)).map(s=>skills.readSkill(s.id));
    const prompt=request+skills.loadedSkillContext(loaded,{designProfile:'max'});
    const run={label,status:'running',routed:routed.map(s=>s.id),loaded:loaded.map(s=>({id:s.id,hash:s.contentHash})),events:[],deniedPermissions:0,startedAt:new Date().toISOString()};report.runs.push(run);save();
    const start=Date.now();
    try{
      const result=await runOpenCodeSession({taskId:'layout-options-'+crypto.randomUUID(),modelId,variant:report.variant,readOnly:true,
        timeoutMs:600000,idleTimeoutMs:120000,directory:root,
        systemPrompt:'This is website design planning only. The supplied managed skills are authoritative guidance within the human brief. Return public Option A, Option B, selection and selected blueprint as readable Markdown. Do not use tools or create a website. Do not narrate hidden reasoning.',
        parts:[{type:'text',text:prompt}],onPermission:async()=>{run.deniedPermissions++;save();return false;},
        onRequest:trace=>{run.trace=trace;save();},
        onEvent:event=>{if(/permission|tool/.test(event.type)||event.properties?.part?.type==='tool'){run.events.push({type:event.type,tool:event.properties?.part?.tool,status:event.properties?.part?.state?.status});save();}}});
      run.status='returned';run.usage=result.usage;run.durationMs=Date.now()-start;run.textFile=label+'.md';
      fs.writeFileSync(path.join(root,run.textFile),result.text);
      run.words=result.text.trim().split(/\s+/).length;
    }catch(error){run.status='failed';run.error=error.message;run.durationMs=Date.now()-start;}
    save();console.log(JSON.stringify({label,status:run.status,durationMs:run.durationMs,error:run.error,root}));
    if(run.error&&/HTTP (401|403|429)|quota|credit/i.test(run.error))break;
  }
}finally{runtime.shutdown();save();}})().catch(error=>{report.error=error.message;save();console.error(error.message);process.exitCode=1;});
