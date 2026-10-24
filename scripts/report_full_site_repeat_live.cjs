// Experiment reporting only; generated sites and production guidance stay unchanged.
const fs=require('fs'),path=require('path');
const root=path.resolve(process.argv[2]);
const report=JSON.parse(fs.readFileSync(path.join(root,'report.json')));
const inspection=JSON.parse(fs.readFileSync(path.join(root,'inspection.json')));
const {createTaskMemoryStore}=require('../electron/agent/task-memory-store.cjs');
const store=createTaskMemoryStore({getPath:()=>path.join(root,'shared-engine')});
const rows=report.runs.map(run=>{
 const memory=store.read(run.taskId);
 const views=inspection.runs.find(x=>x.label===run.label)?.views??[];
 return {label:run.label,seconds:Math.round(run.durationMs/1000),status:run.status,harnessTimeout:run.harnessTimeout===true,
  brief:memory.designReview?.brief,comparison:memory.designReview?.diversity,visualReviewCount:memory.designReview?.reviews?.length??0,
  observedWidths:memory.designReview?.observedComposition?.views?.map(v=>v.width)??[],
  freshObservation:memory.designReview?.observedComposition?.fingerprint===memory.designReview?.sourceFingerprint,
  toolFailures:run.events.filter(x=>x.phase==='completed'&&x.failed).map(x=>({name:x.name,output:x.output})),
  providerRetries:run.events.filter(x=>x.type==='activity'&&/provider request failed/i.test(x.detail)).map(x=>x.detail),
  views:views.filter(v=>v.metrics).map(v=>({label:v.label,height:v.metrics.height,overflow:v.metrics.documentWidth>v.metrics.width,errors:v.errors,
   brokenImages:v.metrics.brokenImages,flow:v.flow,accessibility:v.accessibility,readableContent:v.readableContent,
   scrollFailures:v.scrollStates?.filter(s=>s.readableContent.failures.length)}))};
});
const summary={modelId:report.modelId,temperature:report.temperature,reviewMode:report.reviewMode,sourceUnchanged:report.sourceUnchanged,runs:rows};
for(const dir of [root,report.output])fs.writeFileSync(path.join(dir,'summary.json'),JSON.stringify(summary,null,2));
for(const [name,data] of [['generation-report.json',report],['inspection-report.json',inspection]])fs.writeFileSync(path.join(report.output,name),JSON.stringify(data,null,2));
const findings=fs.readFileSync(path.join(root,'findings.md'),'utf8');
fs.writeFileSync(path.join(report.output,'README.md'),findings);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cards=rows.map(run=>`<article><h2>${esc(run.label)}</h2><p>${run.seconds}s · ${run.harnessTimeout?'experiment cutoff':esc(run.status)}</p><a href="${esc(run.label)}/index.html">Open website</a><figure><img src="_inspection/${esc(run.label)}-desktop.png" alt="${esc(run.label)} desktop"></figure><figure class="mobile"><img src="_inspection/${esc(run.label)}-mobile.png" alt="${esc(run.label)} mobile"></figure><details><summary>Recorded results</summary><pre>${esc(JSON.stringify(run,null,2))}</pre></details></article>`).join('');
fs.writeFileSync(path.join(report.output,'comparison.html'),`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Orvix two fresh Default websites</title><style>body{margin:0;padding:28px;background:#eef0f2;color:#20262b;font:16px/1.5 Arial}header{max-width:1100px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:22px}article{background:white;padding:20px;min-width:0}img{display:block;width:100%}figure{margin:16px 0}.mobile{width:35%;margin-inline:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}a{color:#154f96}@media(max-width:800px){.grid{grid-template-columns:1fr}}</style><header><h1>Two fresh Default websites</h1><p>Same brief · ${esc(report.modelId)} · requested temperature 0.7 · visual review off</p><p>Read <a href="README.md">findings and limits</a> before interpreting passing checks.</p></header><main class="grid">${cards}</main></html>`);
console.log(JSON.stringify(summary,null,2));
