// Real public services and production research guards. This does not invoke
// a model or record a microphone; Gemini Live acceptance is a separate test.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const project = path.resolve(__dirname, '..');
require('../electron/live-env.cjs').loadLiveEnv(project);
const built = require('esbuild').buildSync({entryPoints:[path.join(project,'src/fastResearch.ts')],bundle:true,platform:'node',format:'cjs',write:false,logLevel:'silent'});
const loaded = new Module(__filename,module);loaded.filename=__filename;loaded.paths=module.paths;loaded._compile(built.outputFiles[0].text,__filename);
const {fastResearchTaskFor,gatherFastResearch}=loaded.exports;
const {searchWeb,readSearchResultPage}=require('../electron/search.cjs');
const {getWeather}=require('../electron/weather.cjs');
const report={startedAt:new Date().toISOString(),scope:'Production public search/page/weather services and source guards; no model, microphone or speaker playback.',searches:[],pages:[],checks:[],weather:[]};
const output=path.join(__dirname,'check_fast_production_services.report.json');
const save=()=>fs.writeFileSync(output,JSON.stringify(report,null,2));
const bridge={searchWeb:async input=>{const result=await searchWeb(input);report.searches.push({query:input.query,status:result.status,message:result.message});save();return result;},readSearchPage:async input=>{const result=await readSearchResultPage(input);report.pages.push({url:input.url,finalUrl:result.url,status:result.status,source:result.source});save();return result;}};
(async()=>{
  const domain=fastResearchTaskFor('Search florianbd com', '', true);
  const sources=await gatherFastResearch(domain,bridge,()=>{},'florianbd com');
  assert.ok(sources.some(source=>source.status==='verified'),'Supplied Florian BD domain must be read directly despite a missing search result');
  assert.ok(sources.every(source=>{const host=new URL(source.url).hostname;return host==='florianbd.com'||host.endsWith('.florianbd.com');}));
  assert.ok(report.pages.every(page=>{const host=new URL(page.url).hostname;return host==='florianbd.com'||host.endsWith('.florianbd.com');}));
  report.checks.push({name:'Real domain query excludes unrelated pages',status:'passed',sourceCount:sources.length,failedPages:domain.failedPages,searchFailures:domain.searchFailures||[]});save();
  const retailer=fastResearchTaskFor('Research Daraz Bangladesh returns using official sources');
  const retailSources=await gatherFastResearch(retailer,bridge,()=>{},'site:daraz.com.bd return policy');
  assert.ok(retailSources.some(source=>source.status==='verified'),'At least one live retailer policy page must be readable');
  assert.ok(retailSources.every(source=>new URL(source.url).hostname==='daraz.com.bd'||new URL(source.url).hostname.endsWith('.daraz.com.bd')));
  report.checks.push({name:'Real official Bangladesh retailer search and direct reads',status:'passed',sources:retailSources.map(({url,status})=>({url,status}))});save();
  for(const location of ['Dhaka','Chattogram','Rajshahi','Khulna','Barishal','Sylhet','Rangpur','Mymensingh']){
    const result=await getWeather({location});report.weather.push({requestedCity:location,...result});save();
    assert.equal(result.status,'ok');assert.match(result.location,/Bangladesh/);assert.equal(typeof result.temperature,'string');
  }
  report.checks.push({name:'Real weather lookup for eight representative Bangladesh cities',status:'passed'});
  report.status='passed';
})().catch(error=>{report.status='failed';report.error=error.message;process.exitCode=1;console.error(error);}).finally(()=>{report.finishedAt=new Date().toISOString();save();console.log(`Production public services: ${report.status}`);});
