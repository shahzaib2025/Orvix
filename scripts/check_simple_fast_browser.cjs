const assert=require('node:assert/strict'),http=require('node:http'),path=require('node:path');
const {chromium}=require('playwright-core'),esbuild=require('esbuild');
const fixture=`
import {SimpleFastVoiceSession} from './src/simpleFastVoice';
window.runSimpleFastAudioCheck=async()=>{
  const deliveries=[],dispatches=[],transcripts=[];let audioStarted,toolResponses=0,captureCount=0;
  const voice=new SimpleFastVoiceSession([],{onStatus(){},onTranscript:entry=>{transcripts.push({...entry});if(entry.phase==='progress'&&entry.delivery==='complete')deliveries.push(performance.now());}});
  voice.stopped=false;voice.taskActive=true;voice.taskStartedAt=Date.now();voice.language='en';
  voice.session={sendToolResponse(){toolResponses++;},sendClientContent(){},sendRealtimeInput(){captureCount++;},close(){}};
  window.orvixDesktop={logLive(){},listDirectory:async()=>{dispatches.push({at:performance.now(),playing:voice.audioEngine.hasPlayback,delivered:deliveries.length});return {status:'ok',entries:[]};}};
  const pcm=btoa(String.fromCharCode(...new Uint8Array(12000)));
  voice.narrator={render:async()=>[pcm,pcm],close(){}};
  voice.progressVoice={prepare:async()=>{},close(){},generate:async context=>({text:'I will inspect the requested directory.',audio:[pcm,pcm],generationMs:0})};
  const play=voice.audioEngine.playAudio.bind(voice.audioEngine);
  voice.audioEngine.playAudio=data=>{audioStarted??=performance.now();play(data);};
  const input=new AudioContext(),destination=input.createMediaStreamDestination(),gain=input.createGain(),source=input.createOscillator();
  source.frequency.value=240;gain.gain.value=0.1;source.connect(gain).connect(destination);source.start();
  Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async()=>destination.stream});
  const wait=async check=>{const deadline=performance.now()+5000;while(!check()&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));if(!check())throw Error('Audio fixture did not finish');};
  let clearCalls=0;const clear=voice.audioEngine.clearPlayback.bind(voice.audioEngine);voice.audioEngine.clearPlayback=()=>{clearCalls++;clear();};
  try{
    await voice.audioEngine.ensureContext();await input.resume();await voice.enableMicrophone();
    voice.receive({toolCall:{functionCalls:[1,2].map(i=>({id:String(i),name:'list_directory',args:{directory:'fixture'+i}}))}});
    await wait(()=>toolResponses===1&&!voice.pumping);
    if(dispatches.length!==1)throw Error('A batch ran more than one action before returning its result');
    voice.receive({toolCall:{functionCalls:[{id:'reconsidered-2',name:'list_directory',args:{directory:'fixture2'}}]}});
    await wait(()=>toolResponses===2&&!voice.pumping);
    const busyCapture=captureCount,automaticClears=clearCalls;
    voice.taskActive=false;voice.serverBusy=false;await wait(()=>captureCount>0);const idleCapture=captureCount;
    voice.taskActive=true;voice.serverBusy=true;
    voice.receive({serverContent:{outputTranscription:{text:'The report is ready.'},turnComplete:true}});
    await wait(()=>voice.audioEngine.hasPlayback);voice.sendText('List another directory');
    const requestsBeforeDrain=voice.userQueue.length;await wait(()=>transcripts.some(e=>e.phase==='final'&&e.delivery==='complete'));
    return {dispatches,deliveries,busyCapture,idleCapture,automaticClears,requestsBeforeDrain,firstPlaybackMs:dispatches[0].at-audioStarted};
  }finally{voice.stop();source.stop();await input.close();}
};`;
const javascript=esbuild.buildSync({stdin:{contents:fixture,resolveDir:path.join(__dirname,'..'),loader:'ts'},bundle:true,platform:'browser',format:'iife',write:false,logLevel:'silent'}).outputFiles[0].text;
const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/fixture.js'?'application/javascript':'text/html');res.end(req.url==='/fixture.js'?javascript:'<script src="/fixture.js"></script>');});
(async()=>{let browser;
  try{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    browser=await chromium.launch({channel:'chromium',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
    const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port);
    const result=await page.evaluate(()=>window.runSimpleFastAudioCheck());
    assert.equal(result.dispatches.length,2);assert.ok(result.dispatches.every((item,i)=>!item.playing&&item.delivered>=i+1));
    assert.ok(result.firstPlaybackMs>=450,'tool started before both audio buffers drained');
    assert.equal(result.busyCapture,0);assert.ok(result.idleCapture>0);assert.equal(result.automaticClears,0);assert.equal(result.requestsBeforeDrain,1);
    console.log('Simple Fast real Web Audio check passed: sequential tools waited for full speech, synthetic microphone input was gated during work, and no automatic playback cutoff occurred. Synthetic input/PCM; physical microphone and speakers not verified.');
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
