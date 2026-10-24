const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),Module=require('node:module'),{EventEmitter}=require('node:events');
const {installScreenSharing}=require('../electron/screen-sharing.cjs');
function backend(getGuard=()=>null){
 const handlers={},frame={},webContents=Object.assign(new EventEmitter(),{mainFrame:frame}),window=Object.assign(new EventEmitter(),{webContents,isDestroyed:()=>false}),protectionChanges=[];
 let requestHandler,protectable=true,sources=[{id:'screen:0:0',name:'Display 1',thumbnail:{toDataURL:()=> 'data:image/png;base64,fixture'}}];
 const controller=installScreenSharing({session:{setDisplayMediaRequestHandler:f=>requestHandler=f},ipcMain:{handle:(name,f)=>handlers[name]=f},desktopCapturer:{getSources:async()=>sources},getMainWindow:()=>window,compositionDelayMs:0,getPetCaptureGuard:getGuard,setPetCaptureExcluded:active=>{protectionChanges.push(active);return !active||protectable;}});
 const event={sender:webContents,senderFrame:frame};
 const choose=async()=>{await handlers['orvix:screen-sources'](event);handlers['orvix:screen-select'](event,'screen:0:0');return handlers['orvix:screen-pet-exclusion'](event,true);};
 return {handlers,event,frame,window,webContents,controller,choose,protectionChanges,setProtectable:p=>protectable=p,setSources:s=>sources=s,request:(overrides={})=>new Promise(resolve=>requestHandler({frame,videoRequested:true,audioRequested:false,...overrides},resolve))};
}
test('only a chosen available screen can be granted, and selection is consumed once',async()=>{const f=backend();assert.equal(await f.request(),null);const sources=await f.handlers['orvix:screen-sources'](f.event);assert.equal(sources[0].kind,'screen');assert.throws(()=>f.handlers['orvix:screen-select'](f.event,'screen:99:0'));f.handlers['orvix:screen-select'](f.event,sources[0].id);assert.equal(await f.request(),null);await f.handlers['orvix:screen-pet-exclusion'](f.event,true);const granted=await f.request();assert.equal(granted.video.id,sources[0].id);assert.equal(granted.audio,undefined);assert.equal(await f.request(),null);});
test('other renderers/frames and audio requests cannot capture a selected screen',async()=>{const f=backend();await assert.rejects(f.handlers['orvix:screen-sources']({sender:{},senderFrame:{}}));await f.handlers['orvix:screen-sources'](f.event);f.handlers['orvix:screen-select'](f.event,'screen:0:0');await f.handlers['orvix:screen-pet-exclusion'](f.event,true);assert.equal(await f.request({frame:{}}),null);assert.equal(await f.request({audioRequested:true}),null);assert.equal((await f.request()).video.id,'screen:0:0');});
test('cancellation and disappeared sources fail closed',async()=>{const f=backend();await f.handlers['orvix:screen-sources'](f.event);f.handlers['orvix:screen-select'](f.event,'screen:0:0');f.handlers['orvix:screen-select'](f.event,null);assert.equal(await f.request(),null);await f.handlers['orvix:screen-sources'](f.event);f.handlers['orvix:screen-select'](f.event,'screen:0:0');await f.handlers['orvix:screen-pet-exclusion'](f.event,true);f.setSources([]);assert.equal(await f.request(),null);});
function load(file){const code=require('esbuild').buildSync({entryPoints:[path.join(__dirname,'../src',file)],bundle:true,platform:'node',format:'cjs',write:false,logLevel:'silent'}).outputFiles[0].text;const m=new Module(__filename,module);m.paths=module.paths;m._compile(code,__filename);return m.exports;}
test('capture bounds resolution, throttles frames, and releases tracks on stop',async t=>{const previews=[],frames=[],video={muted:false,playsInline:false,readyState:2,videoWidth:3840,videoHeight:2160,play:async()=>{},pause(){},srcObject:null},canvas={width:0,height:0,getContext:()=>({drawImage(){}}),toDataURL:(mime,quality)=>{assert.equal(mime,'image/jpeg');assert.equal(quality,.9);return 'data:image/jpeg;base64,SCREEN';}};global.document={createElement:kind=>kind==='video'?video:canvas};const {LiveScreenCapture}=load('screenSharing.ts');let stopped=0,endedListener;const track={readyState:'live',addEventListener:(name,f)=>endedListener=f,stop:()=>stopped++};const capture=new LiveScreenCapture(data=>{frames.push(data);return true;},()=>{},()=>{},frame=>previews.push(frame));t.after(()=>capture.stop());await capture.start({getVideoTracks:()=>[track],getTracks:()=>[track]});assert.equal(frames.length,1);assert.equal(canvas.width,2560);assert.equal(canvas.height,1440);assert.equal(frames[0],previews[0]);assert.equal(frames[0].jpeg,'SCREEN');assert.ok(frames[0].capturedAt>0);capture.capture();assert.equal(frames.length,1);capture.stop();assert.equal(stopped,1);assert.equal(video.srcObject,null);capture.capture();assert.equal(frames.length,1);endedListener();assert.equal(stopped,1);});
test('both profiles send JPEG video only while sharing and connected',()=>{global.window={orvixDesktop:{logLive(){}}};for(const [file,klass,args] of [['simpleFastVoice.ts','SimpleFastVoiceSession',[[],{onStatus(){},onTranscript(){}}]],['thinkingVoice.ts','ThinkingVoiceSession',['LOW',[],{onStatus(){},onTranscript(){}}]]]){const Class=load(file)[klass],v=new Class(...args),sent=[];v.stopped=false;v.session={sendClientContent(){},sendRealtimeInput:e=>sent.push(e)};assert.equal(v.sendScreenFrame('IMAGE'),false);v.setScreenSharing(true);assert.equal(v.sendScreenFrame('IMAGE'),true);assert.deepEqual(sent[0],{video:{data:'IMAGE',mimeType:'image/jpeg'}});v.setScreenSharing(false);assert.equal(v.sendScreenFrame('IMAGE'),false);v.setScreenSharing(true);v.stopped=true;assert.equal(v.sendScreenFrame('IMAGE'),false);assert.equal(sent.length,1);}});

test('capture exclusion requires the main frame and an explicit source, and fails closed',async()=>{
 const f=backend();await assert.rejects(f.handlers['orvix:screen-pet-exclusion']({sender:{},senderFrame:{}},true));
 await assert.rejects(f.handlers['orvix:screen-pet-exclusion'](f.event,true));f.setProtectable(false);await assert.rejects(f.choose(),/could not be excluded/);assert.equal(await f.request(),null);assert.deepEqual(f.protectionChanges,[true,false]);
});
test('stale cleanup cannot remove a newer capture exclusion lease',async()=>{
 const f=backend(),old=await f.choose(),current=await f.choose();await f.handlers['orvix:screen-pet-exclusion'](f.event,false,old);assert.ok((await f.request()).video);
 await f.handlers['orvix:screen-pet-exclusion'](f.event,false,current);assert.equal(f.protectionChanges.at(-1),false);assert.equal(await f.request(),null);
});
test('native hide, renderer crash, navigation and disposal release pet exclusion',async()=>{
 for(const scenario of ['hide','closed','crash','destroyed','navigation','dispose']){const f=backend();await f.choose();
 if(scenario==='hide')f.window.emit('hide');if(scenario==='closed')f.window.emit('closed');if(scenario==='crash')f.webContents.emit('render-process-gone');if(scenario==='destroyed')f.webContents.emit('destroyed');if(scenario==='navigation')f.webContents.emit('did-start-navigation',{},'',false,true);if(scenario==='dispose')f.controller.dispose();
 assert.equal(f.protectionChanges.at(-1),false,scenario);assert.equal(await f.request(),null,scenario);}
});
test('freshness rejects old and future frames in both question transports',()=>{
 global.window={orvixDesktop:{logLive(){}}};const {isScreenFrameFresh}=load('screenSharing.ts');assert.equal(isScreenFrameFresh(1000,4499),true);assert.equal(isScreenFrameFresh(1000,4500),false);assert.equal(isScreenFrameFresh(2000,1000),false);
 for(const [file,klass,args] of [['simpleFastVoice.ts','SimpleFastVoiceSession',[[],{onStatus(){},onTranscript(){}}]],['thinkingVoice.ts','ThinkingVoiceSession',['LOW',[],{onStatus(){},onTranscript(){}}]]]){
 const Class=load(file)[klass],v=new Class(...args),sent=[];v.stopped=false;v.session={sendClientContent(){},sendRealtimeInput:e=>sent.push(e)};v.setScreenSharing(true);
 assert.equal(v.sendScreenFrame({jpeg:'OLD',width:1,height:1,capturedAt:Date.now()-4000}),false);assert.equal(sent.length,0);
 const frame={jpeg:'FRESH',width:2560,height:1440,capturedAt:Date.now()-50};assert.equal(v.sendScreenFrame(frame),true);assert.equal(v.screenFrameAt,frame.capturedAt);assert.equal(v.screenFrameParts()[0].inlineData.data,frame.jpeg);
 v.screenFrameAt=Date.now()-4000;assert.deepEqual(v.screenFrameParts(),[]);v.setScreenSharing(false);assert.equal(v.screenFrame,undefined);
 }
});

test('unconfirmed native exclusion uses a guarded fallback and rejects a stale lease',async()=>{
 const guard={mode:'masked',masks:[{x:.1,y:.2,width:.3,height:.4}]},f=backend(()=>guard);f.setProtectable(false);const lease=await f.choose();assert.deepEqual(await f.handlers['orvix:screen-capture-guard'](f.event,lease),guard);assert.ok((await f.request()).video);await assert.rejects(async()=>f.handlers['orvix:screen-capture-guard'](f.event,'old'));await f.handlers['orvix:screen-pet-exclusion'](f.event,false,lease);await assert.rejects(async()=>f.handlers['orvix:screen-capture-guard'](f.event,lease));
});
test('masking precedes encoding and shares the same processed frame with preview',async t=>{
 const order=[],rects=[],sent=[],preview=[],video={readyState:2,videoWidth:1000,videoHeight:500,play:async()=>{},pause(){}},canvas={getContext:()=>({drawImage(){order.push('draw');},fillRect(...r){order.push('mask');rects.push(r);}}),toDataURL:()=>{order.push('encode');return 'data:image/jpeg;base64,MASKED';}};
 global.document={createElement:kind=>kind==='video'?video:canvas};const {LiveScreenCapture}=load('screenSharing.ts');let stops=0;const track={readyState:'live',addEventListener(){},stop(){stops++;}};
 const capture=new LiveScreenCapture(frame=>{sent.push(frame);return true;},()=>{},assert.fail,frame=>preview.push(frame),async()=>({mode:'masked',masks:[{x:.1,y:.2,width:.3,height:.4}]}));t.after(()=>capture.stop());await capture.start({getVideoTracks:()=>[track],getTracks:()=>[track]});assert.deepEqual(order,['draw','mask','encode']);assert.deepEqual(rects,[[100,100,300,200]]);assert.equal(sent[0],preview[0]);assert.equal(sent[0].petExclusion,'masked');
});
test('stopping during a pending guard cannot send or preview a late frame',async()=>{
 const sent=[],video={readyState:2,videoWidth:1000,videoHeight:500,play:async()=>{},pause(){}},canvas={getContext:()=>({drawImage(){}}),toDataURL:()=> 'data:image/jpeg;base64,PRIVATE'};
 global.document={createElement:kind=>kind==='video'?video:canvas};const {LiveScreenCapture}=load('screenSharing.ts');let resolveGuard;const capture=new LiveScreenCapture(frame=>{sent.push(frame);return true;},()=>{},assert.fail,()=>assert.fail('late preview'),()=>new Promise(r=>resolveGuard=r));const track={readyState:'live',addEventListener(){},stop(){}};const start=capture.start({getVideoTracks:()=>[track],getTracks:()=>[track]});await new Promise(r=>setImmediate(r));capture.stop();resolveGuard({mode:'native',masks:[]});await start;assert.equal(sent.length,0);
});

test('empty mediaTypes display permission is granted only for a guarded selection in the main frame',async()=>{
 const f=backend();assert.equal(f.controller.canGrantDisplayMediaPermission(f.event.sender,{isMainFrame:true}),false);await f.choose();assert.equal(f.controller.canGrantDisplayMediaPermission(f.event.sender,{isMainFrame:true}),true);assert.equal(f.controller.canGrantDisplayMediaPermission(f.event.sender,{isMainFrame:false}),false);assert.equal(f.controller.canGrantDisplayMediaPermission({}, {isMainFrame:true}),false);await f.request();assert.equal(f.controller.canGrantDisplayMediaPermission(f.event.sender,{isMainFrame:true}),false);
});

test('question context distinguishes readable current frames from historical frames',()=>{
 const {screenObservationContext}=load('screenSharing.ts');
 assert.match(screenObservationContext(true,Date.now()-50),/fresh screen frame is available/);
 assert.doesNotMatch(screenObservationContext(true,Date.now()-50),/say you cannot see/);
 assert.match(screenObservationContext(true,Date.now()-4000),/No fresh screen frame/);
 assert.match(screenObservationContext(false,Date.now()),/Previous images are historical/);
});

test('Thinking reads current visible values without requiring an unrelated web lookup',()=>{
 const {requiresThinkingWebSearch}=load('thinkingFlow.ts');
 assert.equal(requiresThinkingWebSearch('What is the current invoice number on my shared screen?'),false);
 assert.equal(requiresThinkingWebSearch('What build version is shown in this dashboard?'),false);
 assert.equal(requiresThinkingWebSearch('Research the current price online using the item on my screen'),true);
 assert.equal(requiresThinkingWebSearch('What is the latest Gemini version?'),true);
});

test('portrait capture preserves aspect ratio and rejected frames never enter the preview',async()=>{
 const video={readyState:2,videoWidth:2160,videoHeight:3840,play:async()=>{},pause(){}},canvas={getContext:()=>({drawImage(){}}),toDataURL:()=> 'data:image/jpeg;base64,FRAME'};
 global.document={createElement:kind=>kind==='video'?video:canvas};const {LiveScreenCapture}=load('screenSharing.ts');let stops=0;
 const track={readyState:'live',addEventListener(){},stop(){stops++;}},capture=new LiveScreenCapture(()=>false,()=>{},assert.fail,()=>assert.fail('Rejected frame was previewed'));
 await capture.start({getVideoTracks:()=>[track],getTracks:()=>[track]});assert.equal(canvas.width,810);assert.equal(canvas.height,1440);capture.stop();assert.equal(stops,1);
});

test('a failed per-frame protection guard stops capture without leaking a frame',async()=>{
 const video={readyState:2,videoWidth:1000,videoHeight:500,play:async()=>{},pause(){}},canvas={getContext:()=>({drawImage(){assert.fail('unguarded draw');}})};
 global.document={createElement:kind=>kind==='video'?video:canvas};const {LiveScreenCapture}=load('screenSharing.ts');let stops=0,failures=0;
 const track={readyState:'live',addEventListener(){},stop(){stops++;}},capture=new LiveScreenCapture(()=>assert.fail('unguarded send'),()=>{},()=>failures++,()=>assert.fail('unguarded preview'),async()=>{throw Error('lease lost');});
 await capture.start({getVideoTracks:()=>[track],getTracks:()=>[track]});assert.equal(stops,1);assert.equal(failures,1);assert.equal(video.srcObject,null);assert.equal(capture.timer,undefined);
});

test('screen share phrases recognize explicit English, Banglish and Bangla controls only',()=>{
 const {screenSharingCommand}=load('screenSharingCommands.ts');
 for(const phrase of ['screen e dekho','screen এ দেখো','screen ta dekho','screen share on koro','share screen','look at my screen','স্ক্রিনে দেখো','স্ক্রিন শেয়ার চালু করো','Screen sharing turn kar do.','screen sharing on kar do','screen sharing turn on karo','स्क्रीन शेयरिंग चालू कर दो'])assert.equal(screenSharingCommand(phrase),'start',phrase);
 for(const phrase of ['screen share off koro','screen sharing bondho koro','stop screen sharing','close screen share','স্ক্রিন শেয়ার বন্ধ করো','screen sharing turn off kar do','screen sharing band kar do','स्क्रीन शेयरिंग बंद कर दो'])assert.equal(screenSharingCommand(phrase),'stop',phrase);
 for(const phrase of ['what is on my screen?','the screen sharing button','share the result','screen share maybe','do not screen sharing turn kar do','he said screen sharing turn kar do','screen sharing turn kar do and delete files'])assert.equal(screenSharingCommand(phrase),null,phrase);
});

test('the reported microphone transcript is consumed locally by both profiles',()=>{
 global.window={setTimeout,clearTimeout,orvixDesktop:{logLive(){}}};
 const {screenSharingCommand}=load('screenSharingCommands.ts');
 for(const profile of ['Fast','Thinking']){
  let command=null;const callbacks={onStatus(){},onTranscript(){},onScreenSharingCommand:text=>{command=screenSharingCommand(text);return !!command;}};
  const voice=profile==='Fast'?new (load('simpleFastVoice.ts').SimpleFastVoiceSession)([],callbacks):new (load('thinkingVoice.ts').ThinkingVoiceSession)('LOW',[],callbacks);
  voice.stopped=false;voice.session={sendClientContent(){},sendRealtimeInput(){},sendToolResponse(){},close(){}};
  const message={serverContent:{inputTranscription:{text:'Screen sharing turn kar do.',finished:true},interactionStatus:'IN_PROGRESS'}};
  if(profile==='Fast')voice.receive(message);else voice.handleMessage(message);
  assert.equal(command,'start',profile);assert.deepEqual(voice.history,[],profile);
  assert.equal(profile==='Fast'?voice.taskActive:voice.awaitingAnswer,false,profile);
  voice.stop();
 }
});

test('completed Fast voice share commands open control flow without becoming an assistant task',()=>{
 global.window={orvixDesktop:{logLive(){}}};const {SimpleFastVoiceSession}=load('simpleFastVoice.ts');let command='';const history=[],voice=new SimpleFastVoiceSession(history,{onStatus(){},onTranscript(){},onScreenSharingCommand:text=>{command=text;return true;}});
 voice.stopped=false;voice.session={sendClientContent(){},sendRealtimeInput(){},sendToolResponse(){}};
 voice.receive({serverContent:{inputTranscription:{text:'screen share on koro',finished:true},interactionStatus:'IN_PROGRESS'}});
 assert.equal(command,'screen share on koro');assert.equal(voice.taskActive,false);assert.deepEqual(history,[]);assert.equal(voice.inputText,'');assert.equal(voice.discardUntilBoundary,true);
 voice.receive({serverContent:{interactionStatus:'IDLE',turnComplete:true}});assert.equal(voice.discardUntilBoundary,false);voice.stop();
});
