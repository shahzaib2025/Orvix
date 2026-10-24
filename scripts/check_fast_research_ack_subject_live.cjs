// Real Fast acknowledgment provider; no browser/PC actions. Audio is captured,
// not played through a physical speaker. Never records auth tokens.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');require('../electron/live-env.cjs').loadLiveEnv(root);
global.window={orvixDesktop:{createLiveToken:require('../electron/live-auth.cjs').createLiveToken}};
function load(file){const m=new Module(__filename,module);m.paths=module.paths;m._compile(require('esbuild').buildSync({entryPoints:[path.join(root,'src',file)],bundle:true,platform:'node',format:'cjs',external:['@google/genai'],write:false,logLevel:'silent'}).outputFiles[0].text,__filename);return m.exports;}
const {FastProgressVoice,progressContext,progressMatchesOperation}=load('fastProgressVoice.ts');
const {researchNotice,matchesResearchNotice}=load('fastResearchAcknowledgment.ts');
const voice=new FastProgressVoice(),controller=new AbortController(),results=[],events=[];
const receive=voice.receive.bind(voice);voice.receive=message=>{const c=message.serverContent;events.push({keys:Object.keys(message),contentKeys:c?Object.keys(c):undefined,text:c?.outputTranscription?.text,audioParts:c?.modelTurn?.parts?.filter(p=>p.inlineData).map(p=>p.inlineData.mimeType)});receive(message);};
const deadline=setTimeout(()=>controller.abort(),90000),file=path.join(root,'scratch/fast-research-ack-subject-live.json');
(async()=>{try{
 await voice.prepare();let previous='তথ্যটা খুঁজে দেখি।';
 for(const [name,args,goal,language] of [
  ['read_web_page',{url:'https://developers.openai.com/api/docs/models'},'Compare GPT and Gemini','bn'],
  ['read_web_page',{url:'https://ai.google.dev/gemini-api/docs/models'},'Compare GPT and Gemini','bn'],
  ['web_search',{query:'GPT pricing'},'Find GPT pricing','en'],
  ['web_search',{query:'GPT pricing'},'Find GPT pricing','en'],
 ].slice(0,process.argv.includes('--single')?1:4)){
  const context=progressContext('tool',goal,name,args);context.researchNotice=researchNotice(context,previous,true);
  const started=performance.now();try{const result=await voice.generate(context,language,controller.signal,12000);
   assert.ok(result.audio.length);assert.ok(matchesResearchNotice(result.text,context.researchNotice));assert.ok(progressMatchesOperation(result.text,name));
   results.push({tool:name,subject:context.researchNotice.subject,language,text:result.text,generationMs:result.generationMs,firstAudioGeneratedMs:result.firstAudioMs,totalMs:performance.now()-started,audioChunks:result.audio.length,passed:true});previous=result.text;
  }catch(error){results.push({tool:name,subject:context.researchNotice.subject,passed:false,error:error.message});}
 }
}catch(error){results.push({passed:false,error:error.message});}finally{
 clearTimeout(deadline);voice.close();const passed=results.length===(process.argv.includes('--single')?1:4)&&results.every(r=>r.passed);fs.writeFileSync(file,JSON.stringify({scope:'Real Fast voice generation; captured PCM, no physical audio playback or tool execution',passed,results,events},null,2));console.log(JSON.stringify({passed,results,eventKeys:events.map(e=>e.keys)},null,2));if(!passed)process.exitCode=1;
}})();
