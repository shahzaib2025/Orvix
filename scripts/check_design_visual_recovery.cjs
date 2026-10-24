const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createCanvas}=require('@napi-rs/canvas');
const {createImageStore}=require('../electron/agent/image-store.cjs');
const {readVisualAsset}=require('../electron/agent/visual-asset.cjs');
const {findVisualAssets,imageUrl,boundedBody}=require('../electron/agent/visual-asset-search.cjs');
const {visualImages}=require('../electron/agent/visual-images.cjs');
const http=require('node:http');
const {previewWebsite}=require('../electron/agent/preview-website.cjs');
test('real mobile preview detects content clipped by its container without flagging hidden menus or intentional scrollers',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'orvix-clipping-'));
 const server=http.createServer((_,r)=>r.end('<!doctype html><html lang="en"><title>Clipping fixture</title><style>body{margin:0;overflow-x:hidden}main{position:relative;min-height:100vh;overflow:hidden;width:100%}#cut{position:absolute;left:350px;top:20px;width:100px}#hidden{display:none;width:900px}.rail{position:absolute;top:100px;left:0;width:200px;overflow-x:auto}.wide{width:900px}#intentional{display:block;margin-left:350px}</style><main><h1>Fixture</h1><button id="cut">Menu</button><button id="hidden">Hidden</button><div class="rail"><div class="wide"><a id="intentional" href="#">Carousel item</a></div></div></main></html>'));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));fs.rmSync(root,{recursive:true,force:true});});
 const result=await previewWebsite({url:'http://127.0.0.1:'+server.address().port,taskId:'clip',requestId:'preview',signal:new AbortController().signal,imageStore:createImageStore({getPath:()=>root}),viewports:[{width:390,height:844}]});
 assert.equal(result.views[0].metrics.horizontalOverflow,false);
 assert.deepEqual(result.views[0].metrics.viewportClippedContent.map(x=>x.id),['cut']);
});
test('page and motion evidence preserve labelled image order and deduplicate shared references',()=>{
 const ref=file=>({file,mime:'image/jpeg'});
 const result={views:[{label:'desktop',image:ref('page'),motion:{frames:[{label:'entry',image:ref('a')},{label:'release',image:ref('b')}]}},{label:'mobile',image:ref('mobile')}],images:[ref('page')]};
 assert.deepEqual(visualImages(result).map(x=>[x.file,x.name]),[['page','desktop page'],['a','desktop motion: entry'],['b','desktop motion: release'],['mobile','mobile page']]);
});
test('issued screenshots can be inspected without opening internal folders; other tasks and invented paths cannot',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'orvix-preview-reuse-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const store=createImageStore({getPath:()=>root}),ref=store.savePreview('owner','capture','desktop',createCanvas(4,4).toBuffer('image/jpeg'));
 const options={taskId:'owner',requestId:'read',file:ref.file,imageStore:store,signal:new AbortController().signal,workspaces:{assert(){throw Error('outside workspace')}}};
 assert.equal((await readVisualAsset(options)).images[0].file,ref.file);
 await assert.rejects(readVisualAsset({...options,taskId:'other'}),/outside workspace/);
 await assert.rejects(readVisualAsset({...options,file:path.join(path.dirname(ref.file),'invented.jpg')}),/outside workspace/);
 store.forget('owner');assert.equal(store.previewFor('owner',ref.file),null);
});
test('asset search returns usable image evidence and source credits, filters unsupported licenses, bounds requests',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'orvix-asset-search-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 let calls=0;const image=createCanvas(40,20).toBuffer('image/png');
 const page=(index,license='CC BY-SA 4.0')=>({index,title:'File:Lamp '+index+'.png',imageinfo:[{width:40,height:20,mime:'image/png',url:'https://upload.wikimedia.org/lamp.png',descriptionurl:'https://commons.wikimedia.org/wiki/File:Lamp.png',extmetadata:{LicenseShortName:{value:license},Artist:{value:'<b>Photographer</b>'},LicenseUrl:{value:'https://creativecommons.org/licenses/by-sa/4.0/'}}}]});
 const request=async(url)=>{calls++;return String(url).includes('/w/api.php?')?Response.json({query:{pages:{a:page(1),b:page(2,'Unknown'),c:page(3),d:page(4),e:page(5)}}}):new Response(image,{headers:{'content-type':'image/png'}})};
 const result=await findVisualAssets({query:'pendant lighting',taskId:'asset',requestId:'find',imageStore:createImageStore({getPath:()=>root}),signal:new AbortController().signal},request);
 assert.equal(result.results.length,3);assert.equal(result.images.length,3);assert.equal(calls,4);assert.equal(result.results[0].artist,'Photographer');assert.equal(result.results[0].license,'CC BY-SA 4.0');
 assert.throws(()=>imageUrl('https://127.0.0.1/image.png'));assert.throws(()=>imageUrl('https://evil.example/image.png'));assert.throws(()=>imageUrl('https://upload.wikimedia.org@evil.example/image.png'));
 await assert.rejects(boundedBody(new Response(Buffer.alloc(12)),10),/size limit/);
});
