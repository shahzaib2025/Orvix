const imageHosts = new Set(['upload.wikimedia.org', 'thumb.wikimedia.org']);
const clean = value => String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/&(?:amp|quot|lt|gt);/g, entity => ({'&amp;':'&','&quot;':'"','&lt;':'<','&gt;':'>'})[entity]).replace(/\s+/g, ' ').trim().slice(0, 1200);
function imageUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || !imageHosts.has(url.hostname)) throw Error('Image source is outside Wikimedia image hosts.');
  return url.href;
}
async function boundedBody(response, limit) {
  if (!response.ok) throw Error(`Image source returned HTTP ${response.status}.`);
  if (Number(response.headers.get('content-length')) > limit) throw Error('Image source exceeds the size limit.');
  let size = 0; const chunks = [];
  for await (const chunk of response.body) { size += chunk.length; if (size > limit) { await response.body.cancel?.().catch(() => {}); throw Error('Image source exceeds the size limit.'); } chunks.push(Buffer.from(chunk)); }
  return Buffer.concat(chunks);
}
async function findVisualAssets({ query, provider = 'commons', taskId, requestId, imageStore, signal }, request = fetch) {
  query = String(query ?? '').trim();
  if (!query || query.length > 180) throw Error('Supply a visual subject query under 180 characters.');
  signal.throwIfAborted();
  if(provider==='google') return findGoogleAssets({query,taskId,requestId,imageStore,signal},request);
  if(provider!=='commons')throw Error('Unknown visual search provider.');
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
  const params = new URLSearchParams({action:'query',format:'json',generator:'search',gsrsearch:query,gsrnamespace:'6',gsrlimit:'4',prop:'imageinfo',iiprop:'url|size|mime|extmetadata',iiurlwidth:'1400',iiextmetadatafilter:'Artist|Credit|LicenseShortName|LicenseUrl|ImageDescription'});
  const headers = {'User-Agent':'Orvix/0.1 WebsiteAssetSearch',accept:'application/json'};
  const response = await request('https://commons.wikimedia.org/w/api.php?' + params, {headers,signal:deadline,redirect:'error'});
  const json = JSON.parse((await boundedBody(response, 1_000_000)).toString());
  if (json.error) throw Error('Wikimedia image search is unavailable: ' + clean(json.error.info));
  const candidates = Object.values(json.query?.pages ?? {}).sort((a,b)=>(a.index??0)-(b.index??0)).slice(0,4);
  const results = await Promise.all(candidates.map(async page => {
    const info = page.imageinfo?.[0], meta = info?.extmetadata ?? {};
    const license = clean(meta.LicenseShortName?.value);
    if (!info || !['image/jpeg','image/png','image/webp'].includes(info.mime) || !/^(?:CC0|Public domain|CC BY(?:-SA)? [1-4]\.\d)$/i.test(license)) return null;
    const result = { title: clean(page.title), description: clean(meta.ImageDescription?.value), width: info.width, height: info.height, license, licenseUrl: clean(meta.LicenseUrl?.value), artist: clean(meta.Artist?.value), credit: clean(meta.Credit?.value), sourcePage: info.descriptionurl, url: imageUrl(info.thumburl || info.url) };
    try {
      const bytes = await boundedBody(await request(result.url,{signal:deadline,redirect:'error',headers:{'User-Agent':headers['User-Agent']}}),4_000_000);
      const {loadImage,createCanvas}=require('@napi-rs/canvas'); const image=await loadImage(bytes);
      if (image.width*image.height>40_000_000) throw Error('Image dimensions exceed preview limit.');
      const scale=Math.min(1,1000/Math.max(image.width,image.height)),canvas=createCanvas(Math.max(1,Math.round(image.width*scale)),Math.max(1,Math.round(image.height*scale)));
      const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
      result.image={...imageStore.savePreview(taskId,requestId,'asset',canvas.toBuffer('image/jpeg',65)),name:result.title};
    } catch(error) { if(signal.aborted)throw error; result.previewUnavailable=clean(error.message); }
    return result;
  }));
  signal.throwIfAborted();
  const assets=results.filter(Boolean);
  return {status:assets.length?'found':'no_results',query,provider:'Wikimedia Commons',results:assets,images:assets.map(x=>x.image).filter(Boolean),note:'These are image candidates, not your brand products. Inspect fit before using them. Preserve source/creator/license credits for reused imagery. Do not imply unrelated objects belong to a fictional studio. No project files were changed. If no candidates were found, make at most one broader subject-only query: long marketing phrases can miss Commons file descriptions. Keep any explicit provider restriction. If search is unavailable or the broader query still has no suitable media, report the limitation and choose an honest alternative; do not repeat indefinitely.'};
}
async function findGoogleAssets({query,taskId,requestId,imageStore,signal},request=fetch){
 const {searchSerper,getSearchKeys}=require('../serper-search.cjs');
 const store=getSearchKeys();store?.count('queries');
 const deadline=AbortSignal.any([signal,AbortSignal.timeout(15000)]);
 let results;
 try{results=await searchSerper(query,undefined,request,deadline,'images');}
 catch(error){signal.throwIfAborted();return {status:'unavailable',query,provider:'Google Images via Serper',results:[],images:[],message:clean(error.message),note:'Google image search was unavailable; no other provider was silently substituted.'};}
 store?.recordProvider('Google Images via Serper');
 await Promise.all(results.map(async result=>{
  try{
   const url=new URL(result.thumbnailUrl??result.url);
   if(!/^(?:encrypted-tbn\d+\.gstatic\.com|images\.unsplash\.com|images\.pexels\.com|upload\.wikimedia\.org|thumb\.wikimedia\.org)$/.test(url.hostname))throw Error('Preview host is not supported; inspect the original source.');
   const bytes=await boundedBody(await request(url.href,{signal:deadline,redirect:'error'}),4_000_000);
   const {loadImage,createCanvas}=require('@napi-rs/canvas'),img=await loadImage(bytes);
   if(img.width*img.height>40_000_000)throw Error('Image dimensions exceed preview limit.');
   const scale=Math.min(1,1000/Math.max(img.width,img.height)),canvas=createCanvas(Math.max(1,Math.round(img.width*scale)),Math.max(1,Math.round(img.height*scale)));
   const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
   result.image={...imageStore.savePreview(taskId,requestId,'asset',canvas.toBuffer('image/jpeg',65)),name:result.title};
  }catch(error){if(signal.aborted)throw error;result.previewUnavailable=clean(error.message);}
 }));
 signal.throwIfAborted();
 return {status:results.length?'found':'no_results',query,provider:'Google Images via Serper',results,images:results.map(x=>x.image).filter(Boolean),note:'Google discovers images; reuse rights are not verified by the search result. Inspect sourcePage, choose appropriate reusable imagery, preserve required credit, and embed suitable direct original-resolution HTTPS image URLs rather than search thumbnails in the website. Do not download website assets when the user requests URL-only images. Verify remote image loading in the existing browser preview. No project files were changed.'};
}
function createVisualAssetLookup(search=findVisualAssets) {
 const cache=new Map(),unavailable=new Map();
 return async input=>{
  input.signal?.throwIfAborted();
  const provider=input.provider??'commons',key=provider+':'+String(input.query??'').trim().toLowerCase().replace(/\s+/g,' ');
  if(unavailable.has(provider))return {...unavailable.get(provider),query:input.query,cached:true,note:'This provider is unavailable in this run. Do not repeat the same lookup or silently switch a user-required source. Report the limitation and choose an honest permitted alternative.'};
  if(cache.has(key))return {...await cache.get(key),cached:true};
  const pending=Promise.resolve().then(()=>search(input));cache.set(key,pending);
  try {
   const result=await pending;
   if(result.status==='unavailable'&&/no .*keys?|401|403|429|quota|credentials?/i.test(result.message??''))unavailable.set(provider,result);
   if(cache.size>16)cache.delete(cache.keys().next().value);
   return result;
  }catch(error){cache.delete(key);throw error;}
 };
}
module.exports={findVisualAssets,imageUrl,boundedBody,createVisualAssetLookup};
