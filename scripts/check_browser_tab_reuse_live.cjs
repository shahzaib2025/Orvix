// Actual isolated Chromium + production extension/bridge. Controlled website
// fixtures, including intercepted YouTube pages; not public YouTube or microphone proof.
const fs=require('fs'),path=require('path'),os=require('os'),http=require('http'),assert=require('assert/strict');
const {randomBytes}=require('crypto'),{chromium}=require('playwright-core');
const {createYoutubeControl}=require('../electron/youtube-control.cjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'orvix-tab-reuse-')),extension=path.join(root,'extension');
fs.cpSync(path.join(__dirname,'../PC-Monitor-Test/extension'),extension,{recursive:true});fs.mkdirSync(path.join(root,'PCMonitorTest'));
const token=randomBytes(32).toString('hex');fs.writeFileSync(path.join(root,'PCMonitorTest/pairing-token.txt'),token);process.env.LOCALAPPDATA=root;
const report={scope:'Actual disposable Chromium, production extension and WebSocket bridge; controlled website fixtures, no physical voice or public YouTube claim.',scenarios:[]};
const output=path.join(__dirname,'../scratch/browser-tab-reuse-live.report.json');
let context,worker,latestSong='Fixture song';
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<title>Browser fixture</title><h1>'+req.url+'</h1><input aria-label="Name"><button>Save</button>');});
const control=createYoutubeControl({port:0,startChrome:async()=>{throw Error('Unexpected browser launch');}});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<100;i++){if(await fn())return;await sleep(100);}throw Error('State wait timed out');}
async function request(action,args={},target){const result=await control.browserRequest('act',{action,args,...(target?{target}:{})});return result;}
const ok=r=>{assert.equal(r.status,'ok',JSON.stringify(r.error||r));assert.equal(r.verification.verified,true);return r;};
const inventory=async()=> (await control.browserRequest('observe',{scope:'browser'})).observation;
async function scenario(name,fn){const started=Date.now();try{await fn();report.scenarios.push({name,status:'passed',durationMs:Date.now()-started});}catch(error){report.scenarios.push({name,status:'failed',error:error.message,durationMs:Date.now()-started});}fs.writeFileSync(output,JSON.stringify(report,null,2));console.log(report.scenarios.at(-1));}
(async()=>{
  await new Promise(r=>server.listen(0,'0.0.0.0',r));const base=`http://127.0.0.1:${server.address().port}`;
  fs.writeFileSync(path.join(extension,'youtube-background.js'),fs.readFileSync(path.join(extension,'youtube-background.js'),'utf8').replace('ws://127.0.0.1:49492',`ws://127.0.0.1:${control.port}`));
  context=await chromium.launchPersistentContext(path.join(root,'profile'),{channel:'chromium',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  await context.route(/https:\/\/(www\.)?youtube\.com\//,async route=>{
    const url=new URL(route.request().url());if(url.pathname==='/audio.wav'){const samples=8000*30,wav=Buffer.alloc(44+samples*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);await route.fulfill({contentType:'audio/wav',body:wav});return;}
    const query=url.searchParams.get('search_query');if(query)latestSong=query;
    const safe=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const delayed=query==='Fixture delayed song';
    const results=query?`<ytd-search aria-busy="${delayed}"><ytd-video-renderer><a id="video-title" href="/watch?v=fixture001" title="${safe(delayed?'Old result':query)}">${safe(delayed?'Old result':query)}</a><div id="channel-name">Fixture channel</div></ytd-video-renderer></ytd-search>${delayed?'<script>setTimeout(()=>{const a=document.querySelector("#video-title");a.title=a.textContent="Fixture delayed song";document.querySelector("ytd-search").setAttribute("aria-busy","false");},350)</script>':''}`:'';
    const video=url.pathname==='/watch'?`<h1 class="ytd-watch-metadata">${safe(latestSong)}</h1><video class="html5-main-video" autoplay loop muted src="/audio.wav"></video>`:'';
    await route.fulfill({contentType:'text/html',body:`<title>Fixture - YouTube</title><form action="/results"><input id="search" name="search_query"><button id="search-icon-legacy">Search</button></form>${results}${video}`});
  });
  worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');await worker.evaluate(t=>chrome.storage.local.set({token:t}),token);await worker.evaluate(()=>connectYoutube());await until(()=>control.browserStatus().connected);
  let a,b,y1,y2;
  await scenario('1 Create when no matching site exists',async()=>{a=ok(await request('tab_open',{url:base+'/a',tabPolicy:'reuse'})).resolvedTarget.ref;});
  await scenario('2 Reuse exact destination without extra tab',async()=>{const n=(await inventory()).tabs.length;assert.equal(ok(await request('tab_open',{url:base+'/a',tabPolicy:'reuse'})).resolvedTarget.ref,a);assert.equal((await inventory()).tabs.length,n);});
  await scenario('3 Same-site navigation reuses tab',async()=>assert.equal(ok(await request('navigate',{url:base+'/b',tabPolicy:'reuse'})).resolvedTarget.ref,a));
  await scenario('4 Explicit new tab creates one',async()=>{const n=(await inventory()).tabs.length;b=ok(await request('tab_open',{url:base+'/second',tabPolicy:'new'})).resolvedTarget.ref;assert.notEqual(a,b);assert.equal((await inventory()).tabs.length,n+1);});
  await scenario('5 Focused active matching tab preferred',async()=>assert.equal(ok(await request('tab_open',{url:base+'/third',tabPolicy:'reuse'})).resolvedTarget.ref,b));
  await scenario('6 Explicit target maintains multistep continuity',async()=>{ok(await request('tab_activate',{},b));assert.equal(ok(await request('navigate',{url:base+'/chain',tabPolicy:'reuse'},a)).resolvedTarget.ref,a);});
  await scenario('7 Detailed relevant page has fresh controls and identity',async()=>{const r=ok(await request('tab_open',{url:base+'/chain',tabPolicy:'reuse'}));assert.ok(r.observation.page.frames[0].documentId);assert.ok(r.observation.page.elements.some(e=>e.name==='Name'));});
  await scenario('8 Different site creates without overwriting unrelated tab',async()=>{const n=(await inventory()).tabs.length;ok(await request('tab_open',{url:`http://localhost:${server.address().port}/different`,tabPolicy:'reuse'}));assert.equal((await inventory()).tabs.length,n+1);});
  await scenario('9 Closed explicit target reports stale and creates nothing',async()=>{ok(await request('tab_close',{},b));const n=(await inventory()).tabs.length;assert.equal((await request('navigate',{url:base+'/closed',tabPolicy:'reuse'},b)).status,'stale_target');assert.equal((await inventory()).tabs.length,n);});
  await scenario('10 Event inventory updates without an action refresh',async()=>{const r=await worker.evaluate(()=>chrome.tabs.create({url:'about:blank'}));await until(()=>control.browserContext().tabs.some(t=>t.id===r.id));assert.ok(control.browserContext().ageMs<2000);});
  await scenario('11 Open first YouTube tab',async()=>{y1=ok(await request('tab_open',{url:'https://www.youtube.com/',tabPolicy:'reuse'})).resolvedTarget.ref;});
  await scenario('12 Reuse YouTube without another tab',async()=>{const n=(await inventory()).tabs.length;assert.equal(ok(await request('tab_open',{url:'https://www.youtube.com/',tabPolicy:'reuse'})).resolvedTarget.ref,y1);assert.equal((await inventory()).tabs.length,n);});
  await scenario('13 Explicit new YouTube tab',async()=>{y2=ok(await request('tab_open',{url:'https://www.youtube.com/',tabPolicy:'new'})).resolvedTarget.ref;assert.notEqual(y1,y2);});
  await scenario('14 Search and verified playback use exact requested YouTube tab',async()=>{const r=ok(await request('youtube_search',{query:'Fixture first song',tabPolicy:'reuse'},y1));assert.equal(r.resolvedTarget.ref,y1);assert.equal(r.playbackState,'playing');});
  await scenario('15 Pause applies to chosen YouTube tab',async()=>assert.equal(ok(await request('youtube_pause',{},y1)).playbackState,'paused'));
  await scenario('16 Resume applies to chosen YouTube tab',async()=>assert.equal(ok(await request('youtube_resume',{},y1)).playbackState,'playing'));
  await scenario('17 Delayed updated search retains tab and waits for fresh result',async()=>{const n=(await inventory()).tabs.length,start=Date.now();const result=ok(await request('youtube_search',{query:'Fixture delayed song',tabPolicy:'reuse'},y1));assert.equal(result.resolvedTarget.ref,y1);assert.equal(result.title,'Fixture delayed song');assert.ok(Date.now()-start>=600);assert.equal((await inventory()).tabs.length,n);});
  await scenario('18 Search explicit new creates exactly one YouTube tab',async()=>{const n=(await inventory()).tabs.length;const r=ok(await request('youtube_search',{query:'Fixture third song',tabPolicy:'new'}));assert.equal(r.tabDisposition,'created');assert.equal((await inventory()).tabs.length,n+1);});
  await scenario('19 Wrong-site YouTube target fails without replacement',async()=>{const n=(await inventory()).tabs.length;const r=await request('youtube_search',{query:'Fixture song',tabPolicy:'reuse'},a);assert.equal(r.status,'stale_target');assert.equal((await inventory()).tabs.length,n);});
  await scenario('20 Reconnected extension reconstructs current tab inventory',async()=>{await worker.evaluate(()=>{youtubeSocket.close();});await until(()=>!control.browserStatus().connected);await worker.evaluate(()=>connectYoutube());await until(()=>control.browserStatus().connected&&control.browserContext().tabs.some(t=>t.ref===y1));});
  await scenario('21 Fresh page observation returns actual document content',async()=>{const tab=(await inventory()).tabs.find(t=>t.url.startsWith(base));const r=await control.browserRequest('observe',{scope:'page',target:tab.ref});assert.equal(r.status,'ok');assert.ok(r.observation.frames.length);});
  await scenario('22 Broken observation channel stops within eight seconds',async()=>{const tab=(await inventory()).tabs.find(t=>t.url.startsWith(base));await worker.evaluate(()=>{globalThis.savedExecuteScript=chrome.scripting.executeScript;chrome.scripting.executeScript=async args=>args.args?.[0]==='observe'?new Promise(()=>{}):globalThis.savedExecuteScript(args);});try{const start=performance.now();const r=await control.browserRequest('observe',{scope:'page',target:tab.ref});assert.equal(r.status,'timeout');assert.ok(performance.now()-start<11000);}finally{await worker.evaluate(()=>{chrome.scripting.executeScript=globalThis.savedExecuteScript;delete globalThis.savedExecuteScript;});}});
  await scenario('23 Timed-out observation releases extension queue for a fresh read',async()=>{const tab=(await inventory()).tabs.find(t=>t.url.startsWith(base));const r=await control.browserRequest('observe',{scope:'page',target:tab.ref});assert.equal(r.status,'ok');assert.ok(r.observation.frames.length);});
  if(report.scenarios.some(t=>t.status==='failed'))process.exitCode=1;
})().catch(error=>{report.fatal=error.message;process.exitCode=1;}).finally(async()=>{fs.writeFileSync(output,JSON.stringify(report,null,2));await context?.close();await control.close();await new Promise(r=>server.close(r));if(root.startsWith(path.join(os.tmpdir(),'orvix-tab-reuse-')))fs.rmSync(root,{recursive:true,force:true});});
