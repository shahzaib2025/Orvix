// Real tool-free Fast voice rendering; PCM inspected, no physical microphone or speaker test.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const project=path.join(__dirname,'..');require('../electron/live-env.cjs').loadLiveEnv(project);
global.window={orvixDesktop:{createLiveToken:require('../electron/live-auth.cjs').createLiveToken}};
function load(file){const code=require('esbuild').buildSync({entryPoints:[path.join(project,'src',file)],bundle:true,platform:'node',format:'cjs',write:false,logLevel:'silent'}).outputFiles[0].text;const mod=new Module(__filename,module);mod.paths=module.paths;mod._compile(code,__filename);return mod.exports;}
const {FastNarrator}=load('fastNarrator.ts'),{fastToolAcknowledgment}=load('fastAcknowledgment.ts');
const context={goal:'Compare latest Google and GPT models',steps:[],requirements:[]};
const productionBudget=process.argv.includes('--production-budget');
const cases=[
  ['en','plan_task',{}],
  ['en','web_search',{query:'Google latest Gemini models'}],
  ['en','web_search',{query:'OpenAI latest GPT models'}],
  ['en','review_task',{}],
  ['en','read_web_page',{url:'https://example.com/source'}],
  ['en','read_file',{path:'C:/fixture.txt'}],
  ['en','browser_act',{action:'type'}],
  ['bn','web_search',{query:'Google latest Gemini models'}],
  ['bn','plan_task',{}],
  ['bn','web_search',{query:'OpenAI latest GPT models'}],
  ['bn','read_web_page',{url:'https://ai.google.dev/gemini-api/docs/models'}],
  ['bn','review_task',{}],
];
(async()=>{
  const narrator=new FastNarrator(),report={scope:'Real Gemini Fast Live acknowledgment audio and transcription validation. No external work dispatched. No physical microphone or audible speaker validation.',cases:[]};
  const receive=narrator.receive.bind(narrator);let item;
  narrator.receive=message=>{if(item){const c=message.serverContent;item.messages??=[];item.messages.push({keys:Object.keys(message),transcription:c?.outputTranscription,mimeTypes:c?.modelTurn?.parts?.map(p=>p.inlineData?.mimeType).filter(Boolean),partText:c?.modelTurn?.parts?.map(p=>p.text).filter(Boolean),turnComplete:c?.turnComplete,generationComplete:c?.generationComplete,interactionStatus:c?.interactionStatus});if(c?.outputTranscription?.text)item.transcription=(item.transcription||'')+c.outputTranscription.text;}receive(message);};
  try{for(const [language,name,args] of cases.filter(c=>!process.argv.includes('--bangla')||c[0]==='bn').slice(0,productionBudget?3:cases.length)){item={language,name,text:fastToolAcknowledgment(name,args,language,context)};report.cases.push(item);const started=Date.now();
    try{const audio=await narrator.render(item.text,language,new AbortController().signal,productionBudget?{retry:false,timeoutMs:12000}:{});item.status='passed';item.chunks=audio.length;item.audioSeconds=audio.reduce((sum,data)=>sum+Buffer.from(data,'base64').length,0)/48000;}
    catch(error){item.status='failed';item.error=error.message;process.exitCode=1;}
    item.elapsedMs=Date.now()-started;const {messages,...summary}=item;console.log(JSON.stringify(summary));fs.writeFileSync(path.join(__dirname,productionBudget?'fast-acknowledgments-budget-live.report.json':'fast-acknowledgments-live.report.json'),JSON.stringify(report,null,2));
  }}finally{narrator.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
