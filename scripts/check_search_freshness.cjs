const {test}=require('node:test'),assert=require('node:assert/strict');
const {searchWeb,readSearchResultPage,configureSearchKeys}=require('../electron/search.cjs');
function fixture(t,enabled=true){
  const original=global.fetch;
  configureSearchKeys(enabled?{snapshot:()=>({keys:[{id:'fixture'}]}),reserve:()=>({id:'test-reservation',keyId:'fixture',key:'test-only-placeholder'}),settle(){},count(){},revision:()=>1,recordProvider(){}}:null);
  t.after(()=>{global.fetch=original;configureSearchKeys(null);});
}
test('freshness reaches Serper, skips repeat-query cache and retains date provenance',async t=>{
  fixture(t);const bodies=[];global.fetch=async(_url,options)=>{bodies.push(JSON.parse(options.body));return {ok:true,status:200,json:async()=>({organic:[{title:'Fixture GPT model rumor',link:'https://example.com/rumor',snippet:'Fixture GPT model rumor is unconfirmed.',date:'3 months ago'}]})};};
  const input={query:'Fixture GPT model rumor',freshness:'oneWeek'};
  const first=await searchWeb(input),second=await searchWeb(input);
  assert.equal(bodies.length,2);assert.equal(bodies[0].tbs,'qdr:w');assert.equal(second.cached,undefined);assert.equal(second.cacheBypassed,true);
  assert.equal(first.results[0].date,'3 months ago');assert.equal(first.results[0].datePublished,'3 months ago');assert.ok(Date.parse(first.retrievedAt));assert.equal(first.freshness,'oneWeek');assert.match(first.researchGuidance,/Unknown|Undated|unknown/);
});
test('DuckDuckGo fallback carries the same freshness window and unknown dates remain absent',async t=>{
  fixture(t,false);let requested;global.fetch=async url=>{requested=String(url);return {status:200,text:async()=>'<div class="result results_links results_links_deep web-result"><a class="result__a" href="https://example.com/freshness">Fixture freshness evidence</a><a class="result__snippet">Fixture freshness evidence about models</a>'};};
  const result=await searchWeb({query:'Fixture freshness evidence',freshness:'oneMonth'});assert.equal(new URL(requested).searchParams.get('df'),'m');assert.equal(result.provider,'DuckDuckGo');assert.equal(result.results[0].datePublished,undefined);assert.ok(result.retrievedAt);
});
test('article retrieval retains supplied publication and retrieval dates separately',async t=>{
  fixture(t,false);global.fetch=async()=>({ok:true,status:200,headers:{get:()=>'text/html'},text:async()=>'<html><head><title>Fixture report</title><meta content="2026-01-05T12:00:00Z" property="article:published_time"></head><main><h1>Fixture report</h1><p>The historical report is not proof of current release status.</p></main></html>'});
  const result=await readSearchResultPage({url:'https://example.com/history'});assert.equal(result.status,'ok');assert.equal(result.datePublished,'2026-01-05T12:00:00Z');assert.ok(Date.parse(result.retrievedAt));assert.notEqual(result.retrievedAt,result.datePublished);
});
test('an access challenge is blocked evidence, never a successfully read article',async t=>{
  fixture(t,false);global.fetch=async()=>({ok:true,status:200,headers:{get:()=>'text/html'},text:async()=>'<title>Just a moment...</title><main>Checking your browser</main>'});
  const result=await readSearchResultPage({url:'https://example.com/blocked'});assert.equal(result.status,'blocked');assert.equal(result.content,undefined);assert.match(result.message,/not the requested article/);
});
