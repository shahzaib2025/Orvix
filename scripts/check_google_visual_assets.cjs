const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createSearchKeyStore}=require('../electron/search-key-store.cjs');
const {configureSearchKeys}=require('../electron/serper-search.cjs');
const {findVisualAssets}=require('../electron/agent/visual-asset-search.cjs');
const {createImageStore}=require('../electron/agent/image-store.cjs');
const {createCanvas}=require('@napi-rs/canvas');
test('Google image discovery shares credit accounting, returns original sources and real previews',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'orvix-google-images-'));
 t.after(()=>{configureSearchKeys(null);fs.rmSync(root,{recursive:true,force:true});});
 const store=createSearchKeyStore({getPath:()=>root},{isEncryptionAvailable:()=>false});
 store.add({label:'fixture',key:'fixture-google-image-key-00001',remaining:10});configureSearchKeys(store);
 const bytes=createCanvas(20,10).toBuffer('image/png');let calls=0;
 const request=async(url,options)=>{
  calls++;
  if(String(url).includes('google.serper.dev')){
   assert.equal(url,'https://google.serper.dev/images');assert.equal(JSON.parse(options.body).q,'lighting interior');
   return Response.json({credits:1,images:[{title:'Interior',imageUrl:'https://images.pexels.com/photos/1/photo.jpg',thumbnailUrl:'https://encrypted-tbn0.gstatic.com/images?q=fixture',link:'https://www.pexels.com/photo/1/',imageWidth:1600,imageHeight:1000},{title:'Private',imageUrl:'https://127.0.0.1/image.jpg',link:'https://example.com'}]});
  }
  return new Response(bytes);
 };
 const r=await findVisualAssets({query:'lighting interior',provider:'google',taskId:'task',requestId:'find',imageStore:createImageStore({getPath:()=>root}),signal:new AbortController().signal},request);
 assert.equal(r.provider,'Google Images via Serper');assert.equal(r.results.length,1);assert.equal(r.images.length,1);assert.equal(calls,2);
 assert.match(r.results[0].license,/Not verified/);assert.equal(r.results[0].url,'https://images.pexels.com/photos/1/photo.jpg');
 assert.equal(store.snapshot().totals.successes,1);assert.equal(store.snapshot().totals.credits,1);assert.equal(store.snapshot().totals.queries,1);
 configureSearchKeys(null);
 const unavailable=await findVisualAssets({query:'lighting',provider:'google',signal:new AbortController().signal},()=>{throw Error('must not fall back')});
 assert.equal(unavailable.status,'unavailable');assert.equal(unavailable.provider,'Google Images via Serper');assert.match(unavailable.message,/No Serper keys/);
});
