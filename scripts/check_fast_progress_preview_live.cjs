// Real progress provider with scripted partial-transcription timing. No physical
// microphone, speakers, or tool execution; measures buffered first PCM release.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const project=path.join(__dirname,'..');require('../electron/live-env.cjs').loadLiveEnv(project);
global.window={orvixDesktop:{createLiveToken:require('../electron/live-auth.cjs').createLiveToken}};
function load(file){
  const code=require('esbuild').buildSync({entryPoints:[path.join(project,'src',file)],bundle:true,platform:'node',format:'cjs',write:false,logLevel:'silent'}).outputFiles[0].text;
  const loaded=new Module(__filename,module);loaded.paths=module.paths;loaded._compile(code,__filename);return loaded.exports;
}
const {FastProgressVoice,progressContext}=load('fastProgressVoice.ts');
const {FastProgressPreview}=load('fastProgressPreview.ts');
const voice=new FastProgressVoice(),report={scope:'Real generated Fast speech; scripted partial transcription and 2500ms remaining utterance. Counted PCM, no physical mic/speakers.',samples:[]};
const file=path.join(project,'scratch/fast-prepared-progress-live.report.json');
const save=()=>fs.writeFileSync(file,JSON.stringify(report,null,2));
(async()=>{try{
  await voice.prepare();
  for(const [partial,tail,language,url] of [
    ['Research the latest Gemini models',' and compare their documented uses.','en','https://ai.google.dev/gemini-api/docs/models'],
    ['ফ্লোরিয়ান বিডি সম্পর্কে গবেষণা করে তুলনা করো',' বাংলাদেশের প্রতিযোগীদের সঙ্গে।','bn',undefined],
    ['Compare GPT and Gemini latest models',' using only official evidence and report in Bangla.','bn','https://ai.google.dev/gemini-api/docs/models'],
  ]){
    const context=progressContext('task',partial,url?'read_web_page':undefined,url?{url}:{});
    const preview=new FastProgressPreview(voice,partial,language,context);let endedAt,firstReleasedAt,chunks=0;
    await new Promise(resolve=>setTimeout(resolve,2500));endedAt=Date.now();
    const compatible=preview.matches(partial+tail,language,context);
    if(!compatible)throw Error('Scripted completed request did not match its preparation');
    preview.attach(()=>{firstReleasedAt??=Date.now();chunks++;},()=>{});
    const result=await preview.result;
    report.samples.push({partial,completed:partial+tail,language,compatible,firstAudioAfterEndMs:firstReleasedAt===undefined?undefined:firstReleasedAt-endedAt,providerFirstAudioMs:result?.firstAudioMs,text:result?.text,audioChunks:chunks,valid:!!result});
    preview.discard();save();console.log(JSON.stringify(report.samples.at(-1)));
  }
  report.summary={samples:report.samples.length,valid:report.samples.filter(s=>s.valid).length,allAudioWaitedUntilEnd:report.samples.every(s=>s.firstAudioAfterEndMs>=0),maxFirstAudioAfterEndMs:Math.max(...report.samples.map(s=>s.firstAudioAfterEndMs??Infinity))};
  save();console.log('SUMMARY',JSON.stringify(report.summary));if(report.summary.valid!==report.samples.length)process.exitCode=1;
}finally{voice.close();}})().catch(error=>{console.error(error.message);process.exitCode=1;});
