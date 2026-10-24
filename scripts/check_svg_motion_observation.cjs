const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {previewWebsite}=require('../electron/agent/preview-website.cjs');
const {createImageStore}=require('../electron/agent/image-store.cjs');
const {createDesignReview}=require('../electron/agent/design-review.cjs');
const {listenBrowserLoopback}=require('../electron/agent/browser-loopback.cjs');

test('bounded preview observes SVG stroke/geometry and word paint without mistaking viewport travel for motion',{timeout:45000},async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'orvix-vector-observation-'));
 const html=`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vector observation fixture</title><style>
 body{margin:0;background:#fff;color:#151515}#hero{height:100vh;padding:30px;box-sizing:border-box}svg{width:240px;height:140px}
 #stroke{stroke:#164db6;stroke-width:4;fill:none;stroke-dasharray:200;animation:draw 1.7s linear infinite alternate}
 #morph{stroke:#171717;stroke-width:3;fill:none}#accent{display:inline-block;animation:ink 1.3s linear infinite alternate}
 @keyframes draw{from{stroke-dashoffset:200}to{stroke-dashoffset:0}}@keyframes ink{from{color:#164db6}to{color:#881744}}
 @media(prefers-reduced-motion:reduce){#stroke,#accent{animation:none;stroke-dashoffset:0}}
 </style></head><body><main><section id="hero"><h1 id="still">A readable <span id="accent">study</span></h1><svg viewBox="0 0 240 140" role="img" aria-label="Illustrative vector study"><path id="stroke" d="M20 30 H220"/><path id="morph" d="M20 100 Q120 40 220 100"/></svg><p id="static">Stable reading.</p></section></main><script>
 const shape=document.getElementById('morph');setInterval(()=>{if(matchMedia('(prefers-reduced-motion:reduce)').matches)return;const y=40+Math.round(40*Math.sin(performance.now()/450));shape.setAttribute('d','M20 100 Q120 '+y+' 220 100');},40);
 </script></body></html>`;
 const server=http.createServer((_,res)=>res.end(html));await listenBrowserLoopback(server);
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));fs.rmSync(root,{recursive:true,force:true});});
 const options={url:`http://127.0.0.1:${server.address().port}`,taskId:'svg',requestId:'normal',signal:AbortSignal.timeout(40000),imageStore:createImageStore({getPath:()=>root}),viewports:[{width:1024,height:768}],full_page:false,
  motion:{section:'#hero',observe_selectors:['#stroke','#morph','#accent','#static'],settle_ms:450,checkpoints:Array.from({length:5},()=>({progress:0}))}};
 const result=await previewWebsite(options),frames=result.views[0].motion.frames;
 const values=(index,pick)=>new Set(frames.map(f=>pick(f.observations.targets[index].elements[0])));
 assert.ok(frames.every(f=>f.observations.scrollY===0));
 assert.ok(values(0,e=>e.svg.strokeDashoffset).size>1,'Stroke drawing must be observable even with a fixed bounding box/transform.');
 assert.ok(values(1,e=>e.svg.attributes.d).size>1,'Path morph geometry must be recorded.');
 assert.ok(values(2,e=>e.paint.color).size>1,'Selected-word paint must be observable while text stays unchanged.');
 assert.equal(values(3,e=>e.transform).size,1);
 let reviews=0;
 const create=()=>createDesignReview({enabled:true,brief:'Create a complete professional website',profile:'max',mode:'fast',acceptsImages:true,signal:new AbortController().signal,evidence:{record:()=>({id:'fixture'})},emit:()=>{},review:async()=>{reviews++;return{text:JSON.stringify({status:'approved',summary:'Fixture exercises motion evidence delivery, not design grading.',preserve:[],issues:[]})};}});
 const brief={audience:'Test visitors',primary_action:'Explore',direction:'Neutral fixture',signature:'Vector observation',responsive:'Reduced motion',storyboard:'Fixture states used to test the existing motion gate.'};
 const design=create();await design.setBrief(brief);design.capture(result,{},'source');await design.evaluate('source');assert.equal(reviews,1);
 const reduced=await previewWebsite({...options,requestId:'reduced',reduced_motion:true,motion:{...options.motion,checkpoints:[{progress:0},{progress:0},{progress:0}]}});
 const still=reduced.views[0].motion.frames;
 for(const index of [0,1,2])assert.equal(new Set(still.map(f=>JSON.stringify({svg:f.observations.targets[index].elements[0].svg,paint:f.observations.targets[index].elements[0].paint}))).size,1);
 const staticDesign=create();await staticDesign.setBrief(brief);staticDesign.capture(reduced,{},'source');assert.match((await staticDesign.evaluate('source')).feedback,/actual progression/);assert.equal(reviews,1);
});
