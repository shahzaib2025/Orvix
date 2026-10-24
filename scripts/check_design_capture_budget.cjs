const test=require('node:test'),assert=require('node:assert/strict');
const {createDesignReview}=require('../electron/agent/design-review.cjs');
test('stale captures cannot reset the task-wide follow-up budget',async()=>{
 const d=createDesignReview({enabled:true,brief:'Repair this website layout',profile:'max',mode:'fast',acceptsImages:true,signal:new AbortController().signal,evidence:{record:()=>({id:'fixture'})},emit:()=>{}});
 for(let i=0;i<2;i++){
  d.capture({views:[{image:{file:'fixture'}}]}, {},'before-'+i);
  assert.match((await d.evaluate('after-'+i)).feedback,/inspect the current source/);
 }
 d.capture({views:[{image:{file:'fixture'}}]}, {},'before-2');
 assert.deepEqual(await d.evaluate('after-2'),{});
 assert.equal(d.snapshot().status,'unavailable');
 assert.equal(d.snapshot().captureRequests,2);
 d.capture({views:[{image:{file:'fixture'}}]}, {},'final');
 await d.evaluate('final');assert.equal(d.snapshot().status,'self_inspected');
});
