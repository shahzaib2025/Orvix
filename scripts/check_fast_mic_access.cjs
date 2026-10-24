// Actual default microphone access and PCM capture; no fake device, recording,
// model request or speaker playback. This is not a spoken-request benchmark.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright-core'),esbuild=require('esbuild');
const root=path.join(__dirname,'..');
const javascript=esbuild.buildSync({stdin:{contents:`
 import {AudioEngine} from './src/audioEngine';
 window.checkMicAccess=async()=>{
   const engine=new AudioEngine();let frames=0,peakLevel=0;
   try{
     await engine.ensureContext();await engine.enableMicrophone(()=>{frames++;peakLevel=Math.max(peakLevel,engine.getAudioLevel());});
     await new Promise(resolve=>setTimeout(resolve,2000));
     return {opened:engine.hasMicrophone,frames,peakLevel,deviceLabel:engine.media?.getAudioTracks()[0]?.label||'',contextState:engine.context?.state};
   }finally{engine.close();}
 };`,resolveDir:root,loader:'ts'},bundle:true,platform:'browser',write:false,format:'iife',logLevel:'silent'}).outputFiles[0].text;
const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/mic.js'?'application/javascript':'text/html');res.end(req.url==='/mic.js'?javascript:'<script src="/mic.js"></script>');});
const report={scope:'Actual default audio input through AudioEngine in a temporary Chromium session. No fake input device; only frame counts/levels saved, no audio recording or API transmission. Not a human spoken request, audible-output or packaged-executable test.'};
(async()=>{let browser;
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch({channel:'chromium',headless:true,args:['--use-fake-ui-for-media-stream']});
  const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
  report.result=await page.evaluate(()=>window.checkMicAccess());
  report.passed=report.result.opened&&report.result.frames>0&&report.result.contextState==='running';
  if(!report.passed)process.exitCode=1;
 }catch(error){report.error=error.message;report.passed=false;process.exitCode=1;}
 finally{await browser?.close();await new Promise(resolve=>server.close(resolve));fs.writeFileSync(path.join(root,'scratch/fast-mic-access.report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
})();
