const {test}=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{randomBytes}=require('node:crypto');
const {WebSocket}=require('ws'),{createYoutubeControl}=require('../electron/youtube-control.cjs');
test('phase deadlines reject late results, preserve navigation time and do not replay mutations',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'orvix-phase-')),prior=process.env.LOCALAPPDATA;
 fs.mkdirSync(path.join(root,'PCMonitorTest'));const token=randomBytes(32).toString('hex');fs.writeFileSync(path.join(root,'PCMonitorTest/pairing-token.txt'),token);process.env.LOCALAPPDATA=root;
 const control=createYoutubeControl({port:0,browserTimeouts:{inventory:40,observation:80,action:300}});let socket;const commands=[];
 try {
  while(!control.port)await new Promise(r=>setTimeout(r,5));
  socket=new WebSocket(`ws://127.0.0.1:${control.port}`,{origin:`chrome-extension://${'a'.repeat(32)}`});await new Promise((r,j)=>{socket.once('open',r);socket.once('error',j);});
  const ready=new Promise(r=>socket.once('message',r));socket.send(JSON.stringify({type:'hello',browser:'Chrome',token,protocolVersion:2,sessionId:'phase'}));await ready;
  socket.on('message',raw=>{const m=JSON.parse(raw);if(m.type!=='browser-command')return;commands.push(m);if(m.id==='broken-read'||m.id==='unknown-action')return;setTimeout(()=>socket.readyState===WebSocket.OPEN&&socket.send(JSON.stringify({type:'result',id:m.id,result:{status:m.id==='failed-action'?'failed':'ok',verification:{verified:m.id!=='failed-action'}}})),m.id==='slow-navigation'?130:0);});
  const failed=await control.browserRequest('act',{action:'navigate',target:'current',args:{url:'https://example.com'},requestId:'failed-action'});assert.equal(failed.status,'failed');
  const start=performance.now();const timed=await control.browserRequest('observe',{scope:'page',target:'current',requestId:'broken-read'});assert.equal(timed.status,'timeout');assert.equal(timed.phase,'observation');assert.ok(performance.now()-start<1000);
  socket.send(JSON.stringify({type:'result',id:'broken-read',result:{status:'ok'}}));
  assert.equal((await control.browserRequest('observe',{scope:'page',target:'current',requestId:'broken-read'})).status,'invalid_request');
  const navigation=await control.browserRequest('act',{action:'navigate',target:'current',args:{url:'https://example.com'},requestId:'slow-navigation'});assert.equal(navigation.status,'ok');
  const unknown=await control.browserRequest('act',{action:'navigate',target:'current',args:{url:'https://example.com'},requestId:'unknown-action'});assert.equal(unknown.status,'timeout');assert.equal(unknown.completionUnknown,true);assert.equal(commands.filter(c=>c.id==='unknown-action').length,1);
  const inventory=await control.browserRequest('observe',{scope:'browser',query:'example',requestId:'fresh-health'});assert.equal(inventory.status,'ok');
  assert.ok(commands.find(c=>c.id==='slow-navigation').deadline-commands.find(c=>c.id==='broken-read').deadline>80);
 } finally {socket?.close();control.close();if(prior===undefined)delete process.env.LOCALAPPDATA;else process.env.LOCALAPPDATA=prior;fs.rmSync(root,{recursive:true,force:true});}
});
