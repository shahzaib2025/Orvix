const assert=require('node:assert/strict'), http=require('node:http'), path=require('node:path');
const esbuild=require('esbuild'), {chromium}=require('playwright-core');
const fixture=`
import {FastVoiceSession} from './src/fastVoice';
window.runInterruptionCheck=async()=>{
  const entries=[];
  const voice=new FastVoiceSession([],{onStatus(){},onTranscript:entry=>entries.push({...entry})});
  voice.stopped=false;voice.serverResponseActive=true;
  let sent=0, detectedAt, clearedAt;
  const originalActivity=voice.handleLocalActivity.bind(voice);
  voice.handleLocalActivity=activity=>{if(activity==='start')detectedAt=performance.now();originalActivity(activity);if(activity==='start' && !voice.audioEngine.hasPlayback)clearedAt=performance.now();};
  voice.session={sendRealtimeInput(){sent++;}};
  window.orvixDesktop={logLive(){},cancelFastTask(){},cancelBrowserRequests(){}};
  const input=new AudioContext(), destination=input.createMediaStreamDestination(), gain=input.createGain();
  gain.gain.value=0;gain.connect(destination);
  const sources=[160,320,960].map((frequency,i)=>{const o=input.createOscillator(),g=input.createGain();o.frequency.value=frequency;g.gain.value=[1,.6,.35][i];o.connect(g);g.connect(gain);o.start();return o;});
  navigator.mediaDevices.getUserMedia=async()=>destination.stream;
  try {
    await input.resume();await voice.enableMicrophone();
    const readyAt=performance.now();
    while(sent<3 && performance.now()-readyAt<3000)await new Promise(resolve=>setTimeout(resolve,20));
    if(sent<3)throw new Error('Fixture microphone PCM did not become ready');
    voice.audioEngine.playAudio(btoa(String.fromCharCode(...new Uint8Array(24000))));
    if(!voice.audioEngine.hasPlayback)throw new Error('Fixture audio was not scheduled');
    const started=performance.now();gain.gain.value=.07;
    while(voice.audioEngine.hasPlayback && performance.now()-started<1500)await new Promise(resolve=>setTimeout(resolve,10));
    const elapsedMs=performance.now()-started;
    const stopped=!voice.audioEngine.hasPlayback;
    const sentAtCutoff=sent;await new Promise(resolve=>setTimeout(resolve,150));
    const speakingAtCutoff=voice.localSpeaking,continuedCapture=sent>sentAtCutoff;
    gain.gain.value=0;
    const quietAt=performance.now();while(voice.localSpeaking && performance.now()-quietAt<3000)await new Promise(resolve=>setTimeout(resolve,20));
    if(voice.localSpeaking)throw new Error('Synthetic microphone did not settle');
    voice.handleMessage({serverContent:{interrupted:true}});
    const pcm=btoa(String.fromCharCode(...new Uint8Array(8000)));
    voice.handleMessage({serverContent:{outputTranscription:{text:'A complete fresh answer'},modelTurn:{parts:[{inlineData:{data:pcm,mimeType:'audio/pcm;rate=24000'}}]}}});
    voice.handleMessage({serverContent:{modelTurn:{parts:[{inlineData:{data:pcm,mimeType:'audio/pcm;rate=24000'}}]},turnComplete:true}});
    const deliveryWaited=entries.at(-1)?.delivery==='interrupted' && voice.audioEngine.hasPlayback;
    const drainAt=performance.now();while(voice.audioEngine.hasPlayback && performance.now()-drainAt<3000)await new Promise(resolve=>setTimeout(resolve,10));
    return {elapsedMs,detectionToClearMs:detectedAt===undefined || clearedAt===undefined ? null : clearedAt-detectedAt,stopped,localSpeaking:speakingAtCutoff,continuedCapture,deliveryWaited,deliveryAfterDrain:entries.at(-1)?.delivery};
  } finally {voice.stopped=true;voice.audioEngine.close();sources.forEach(source=>source.stop());await input.close();}
};
window.runAcknowledgmentOrderingCheck=async()=>{
  const deliveries=[],dispatches=[];let audioStarted;
  const voice=new FastVoiceSession([],{onStatus(){},onTranscript:entry=>{if(entry.phase==='progress'&&entry.delivery==='complete')deliveries.push(performance.now());}});
  voice.stopped=false;voice.acknowledgmentEnabled=true;voice.taskRequest='List two folders';voice.sessionLanguage='en';
  voice.session={sendToolResponse(){},sendClientContent(){},close(){}};
  window.orvixDesktop={logLive(){},listDirectory:async()=>{dispatches.push({at:performance.now(),playing:voice.audioEngine.hasPlayback,delivered:deliveries.length});return {status:'ok',entries:[]};}};
  const pcm=btoa(String.fromCharCode(...new Uint8Array(12000)));
  voice.narrator={render:async()=>[pcm,pcm],close(){}};
  const play=voice.audioEngine.playAudio.bind(voice.audioEngine);
  voice.audioEngine.playAudio=data=>{audioStarted??=performance.now();play(data);};
  try{await voice.audioEngine.ensureContext();await voice.handleToolCalls([1,2].map(i=>({id:String(i),name:'list_directory',args:{path:'C:/fixture'+i}})));
    return {dispatches,deliveries,firstPlaybackMs:dispatches[0].at-audioStarted};
  }finally{voice.stop();}
};`;
const javascript=esbuild.buildSync({stdin:{contents:fixture,resolveDir:path.join(__dirname,'..'),loader:'ts'},bundle:true,platform:'browser',format:'iife',write:false,logLevel:'silent'}).outputFiles[0].text;
const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/fixture.js'?'application/javascript':'text/html');res.end(req.url==='/fixture.js'?javascript:'<script src="/fixture.js"></script>');});
(async()=>{
  let browser;
  try {
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    browser=await chromium.launch({channel:'chromium',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
    const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
    const result=await page.evaluate(()=>window.runInterruptionCheck());
    assert.equal(result.stopped,true);assert.equal(result.localSpeaking,true);assert.equal(result.continuedCapture,true);assert.ok(Number.isFinite(result.detectionToClearMs) && result.detectionToClearMs<500,`Detection-to-clear took ${result.detectionToClearMs}ms`);
    assert.equal(result.deliveryWaited,true);assert.equal(result.deliveryAfterDrain,'complete');
    console.log(`Real AudioWorklet cutoff passed: ${Math.round(result.detectionToClearMs)}ms detection-to-clear; ${Math.round(result.elapsedMs)}ms synthetic onset-to-clear; microphone capture continued. Synthetic input; no physical microphone recording.`);
    console.log('Real Web Audio delivery check passed: final acknowledgement waited for both scheduled buffers to drain.');
    const ordering=await page.evaluate(()=>window.runAcknowledgmentOrderingCheck());
    assert.equal(ordering.dispatches.length,2);assert.equal(ordering.deliveries.length,2);
    assert.ok(ordering.dispatches.every((item,index)=>!item.playing&&item.delivered>=index+1));
    assert.ok(ordering.firstPlaybackMs>=450,'The first tool started before its half-second acknowledgment drained');
    console.log('Fast acknowledgment ordering passed with real Web Audio: both tools waited for their complete two-buffer progress audio. Synthetic PCM; no physical speaker or microphone validation.');
  } finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
