// Real provider progress generation; typed context/count PCM, no speakers/mic.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const project=path.join(__dirname,'..');require('../electron/live-env.cjs').loadLiveEnv(project);
global.window={orvixDesktop:{createLiveToken:require('../electron/live-auth.cjs').createLiveToken}};
const code=require('esbuild').buildSync({entryPoints:[path.join(project,'src/fastProgressVoice.ts')],bundle:true,platform:'node',format:'cjs',write:false,logLevel:'silent'}).outputFiles[0].text;
const loaded=new Module(__filename,module);loaded.paths=module.paths;loaded._compile(code,__filename);
const {FastProgressVoice,progressContext}=loaded.exports,voice=new FastProgressVoice();
const report={scope:'Real Fast provider; generated progress speech/transcript, counted PCM, no physical mic/speakers.',samples:[]};
const file=path.join(project,'scratch/fast-generated-progress-live.report.json');
const save=()=>fs.writeFileSync(file,JSON.stringify(report,null,2));
(async()=>{try{
  const warm=Date.now();await voice.prepare();report.warmupMs=Date.now()-warm;
  const prompts=[
    progressContext('task','Achha GPT latest model aur Gemini latest model compare karo to.'),
    progressContext('tool','Compare current GPT and Gemini models','read_web_page',{url:'https://ai.google.dev/gemini-api/docs/models'}),
    progressContext('tool','Compare current GPT and Gemini models','read_web_page',{url:'https://developers.openai.com/api/docs/models'}),
    progressContext('task','Florian BD সম্পর্কে গবেষণা করো এবং প্রতিযোগীদের সঙ্গে তুলনা করো।'),
    progressContext('tool','Florian BD এবং প্রতিযোগীদের তুলনা','web_search',{query:'Florian BD company official site'}),
    progressContext('tool','Compare current GPT and Gemini models','read_web_page',{url:'https://ai.google.dev/gemini-api/docs/models'},{name:'web_search',result:{status:'unavailable'}}),
  ];
  for(const context of prompts){const started=Date.now();let chunks=0,generatedText='';try{const result=await voice.generate(context,'bn',new AbortController().signal,6000,()=>chunks++,text=>generatedText=text);report.samples.push({context,text:result.text,generationMs:result.generationMs,firstAudioMs:result.firstAudioMs,audioChunks:chunks});}catch(error){report.samples.push({context,error:error.message,generatedText,elapsedMs:Date.now()-started});}save();console.log(JSON.stringify(report.samples.at(-1)));}
  const successful=report.samples.filter(s=>!s.error&&s.audioChunks),times=successful.map(s=>s.generationMs).sort((a,b)=>a-b);
  const startup=successful.map(s=>s.firstAudioMs).sort((a,b)=>a-b);
  report.summary={samples:report.samples.length,audible:successful.length,uniqueTexts:new Set(successful.map(s=>s.text)).size,p50StartupMs:startup[Math.floor(startup.length*.5)],p95StartupMs:startup[Math.max(0,Math.ceil(startup.length*.95)-1)],p50GenerationMs:times[Math.floor(times.length*.5)],p95GenerationMs:times[Math.max(0,Math.ceil(times.length*.95)-1)]};
  save();console.log('SUMMARY',JSON.stringify(report.summary));if(successful.length!==prompts.length)process.exitCode=1;
}finally{voice.close();}})().catch(error=>{console.error(error.message);process.exitCode=1;});
