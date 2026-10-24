const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {listenBrowserLoopback}=require('../electron/agent/browser-loopback.cjs');
test('local HTTP listener uses fetch-compatible loopback ports and recovers from a collision',async t=>{
 const first=http.createServer((_,res)=>res.end('fixture'));
 await listenBrowserLoopback(first);
 t.after(()=>new Promise(resolve=>first.close(resolve)));
 const occupied=first.address().port;
 assert.ok(occupied>=49152&&occupied<=65535);assert.equal(first.address().address,'127.0.0.1');
 const second=http.createServer((_,res)=>res.end('second'));
 let choices=0;
 await listenBrowserLoopback(second,()=>choices++===0?occupied:occupied===65535?49152:occupied+1);
 t.after(()=>new Promise(resolve=>second.close(resolve)));
 assert.ok(choices>=2);assert.notEqual(second.address().port,occupied);
 assert.equal(await (await fetch(`http://127.0.0.1:${second.address().port}`)).text(),'second');
 const blocked=http.createServer();await assert.rejects(listenBrowserLoopback(blocked,()=>5061),/dynamic-range/);
 const exhausted=http.createServer();let attempts=0;
 await assert.rejects(listenBrowserLoopback(exhausted,()=>{attempts++;return occupied;}),{code:'EADDRINUSE'});
 assert.equal(attempts,20);assert.equal(exhausted.listening,false);
});
