const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const esbuild = require('esbuild');
const built = esbuild.buildSync({ entryPoints: [path.join(__dirname, '../src/fastResearch.ts')],
  bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent' });
const loaded = new Module(path.join(__dirname, '.fast-research-recovery.cjs'), module);
loaded.filename = path.join(__dirname, '.fast-research-recovery.cjs');
loaded.paths = module.paths;
loaded._compile(built.outputFiles[0].text, loaded.filename);
const { fastResearchTaskFor, fastResearchContext, fastResearchSourceId, fastResearchSourceIssue, gatherFastResearch, fastResearchNeedsMore, fastResearchScopeIssue, missingFastResearchTopics } = loaded.exports;

async function main() {
  const {requestedSearchDomain,researchRecoveryQueries}=loaded.exports;
  assert.equal(requestedSearchDomain('Bangladesh net metering guidance'),undefined);
  assert.equal(requestedSearchDomain('florianbd com'),'florianbd.com');
  const netScope=fastResearchTaskFor('Research the official Bangladesh net metering guidance');
  assert.match(fastResearchSourceIssue(netScope,'https://www.newagebd.net/net-metering'),/secondary source/);
  assert.equal(fastResearchSourceIssue(netScope,'https://sreda.gov.bd/guidelines'),undefined);
  assert.match(fastResearchScopeIssue(netScope,'https://nepra.org.pk/guidelines'),/different country/);
  assert.equal(fastResearchScopeIssue(netScope,'https://sreda.gov.bd/guidelines'),undefined);
  assert.ok(researchRecoveryQueries('IDCOL solar irrigation Bangladesh')[0].startsWith('site:idcol.org'));
  assert.ok(researchRecoveryQueries('Bangladesh net metering')[0].startsWith('site:sreda.gov.bd'));
  assert.ok(researchRecoveryQueries('installed solar capacity Bangladesh').every(query=>!query.includes('products services')));
  const scopedTopic=fastResearchTaskFor('Research Bangladesh net metering guidelines');
  const rejectedReads=[];
  await gatherFastResearch(scopedTopic,{searchWeb:async()=>({status:'ok',results:[{title:'Wind energy authority',url:'https://wind.sreda.gov.bd/about',snippet:'Bangladesh wind energy authority and turbine standards'}]}),readSearchPage:async({url})=>{rejectedReads.push(url);return {status:'ok',source:'direct_page',url,title:'Wind energy authority',content:'Bangladesh wind turbines and wind energy development.'};}},()=>{},'site:sreda.gov.bd net metering guidelines');
  assert.equal(scopedTopic.sources.length,0);assert.ok(!rejectedReads.includes('https://wind.sreda.gov.bd/about'),'An official host alone does not establish relevance to the requested topic');
  for(const prompt of ['Simple question: explain off-grid solar based on a credible source.','Reread the previous statistic and check its date.','Audit our research. Reopen the cited sources.'])assert.ok(fastResearchTaskFor(prompt));
  assert.equal(fastResearchTaskFor('Show current Windows windows and find Notepad on this PC'), null);
  assert.equal(fastResearchTaskFor('আমার পিসিতে Notepad খুঁজে দেখো এবং খোলা Windows উইন্ডো দেখাও'), null);
  const executionResult=fastResearchTaskFor('Read the function calling documentation and explain how the application returns tool results', '', true);
  assert.ok(!executionResult.requiredTopics.includes('returns and refunds'));
  assert.ok(fastResearchTaskFor('Research Florian BD return policy', '', true).requiredTopics.includes('returns and refunds'));
  assert.ok(fastResearchTaskFor('Research Gemini API refund policy', '', true).requiredTopics.includes('returns and refunds'));
  const completion=fastResearchTaskFor('Read the Live API documentation and explain generation completion versus turn completion', '', true);
  completion.answerText='The turnComplete flag indicates turn completion. Sending client content unconditionally interrupts generation. This describes documented interruption behavior.';
  assert.ok(missingFastResearchTopics(completion).includes('generation completion'),'Turn completion alone cannot satisfy a requested generation-versus-turn comparison');
  let unwantedReads = 0;
  const plain = fastResearchTaskFor('find florianbd com', '', true);
  await gatherFastResearch(plain, {
    searchWeb: async()=>({results:[{title:'Hurricane Ian',url:'https://en.wikipedia.org/wiki/Hurricane_Ian'},{title:'A Floridian Sunset',url:'https://nasa.gov/image-article/a-floridian-sunset/'}]}),
    readSearchPage: async({url})=>{assert.equal(url,'https://florianbd.com/');unwantedReads++;return {status:'unavailable',url,message:'Supplied domain unreachable in this fixture'};},
  },()=>{},'florianbd com');
  assert.equal(unwantedReads,1);assert.equal(plain.sources.length,0);
  const supplied = fastResearchTaskFor('find florianbd com', '', true);
  const suppliedSources = await gatherFastResearch(supplied,{
    searchWeb:async()=>({status:'ok',results:[]}),
    readSearchPage:async({url})=>({status:'ok',source:'direct_page',url,title:'Florian BD plant nursery',content:'Florian BD plant nursery sells plants in Bangladesh.'}),
  },()=>{},'florianbd com');
  assert.equal(suppliedSources[0].status,'verified','A missing search-index entry must not hide a readable supplied domain');
  const identity=fastResearchTaskFor('Research Florian BD and compare its competitors. A GitHub username is not proof of business identity.');
  const identityReads=[];
  const identitySources=await gatherFastResearch(identity,{
    searchWeb:async()=>({results:[
      {url:'https://github.com/florian-bd/component-resolver-webpack/pulls',title:'Pull requests florian-bd/component-resolver-webpack'},
      {url:'https://spacehey.com/profile?id=1751878',title:"Florian's Info"},
      {url:'https://florianbd.com/',title:'Florian BD plant nursery',snippet:'Florian BD sells garden plants in Bangladesh'}]}),
    readSearchPage:async({url})=>{identityReads.push(url);return {status:'ok',source:'direct_page',url,title:'Florian BD nursery',content:'Florian BD plant nursery in Bangladesh sells garden plants.'};},
  },()=>{},'Florian BD');
  assert.deepEqual(identityReads,['https://florianbd.com/']);assert.equal(identitySources.length,1);
  const software=fastResearchTaskFor('Research Florian BD GitHub software repository');
  const codeSources=await gatherFastResearch(software,{
    searchWeb:async()=>({results:[{url:'https://github.com/florian-bd/component-resolver-webpack',title:'Florian BD software repository'}]}),
    readSearchPage:async({url})=>({status:'ok',source:'direct_page',url,title:'Florian BD GitHub repository',content:'Florian BD develops software.'}),
  },()=>{},'Florian BD GitHub');
  assert.equal(codeSources[0].status,'verified','Explicit repository research must retain matching GitHub evidence');
  const localMarket=fastResearchTaskFor('Research online marketplaces in Bangladesh');
  const marketReads=[];
  const marketSources=await gatherFastResearch(localMarket,{
    searchWeb:async()=>({results:[
      {url:'https://ecommercenews.eu/amazon-leads-new-top-150-european-marketplaces/',title:'Amazon leads European marketplaces'},
      {url:'https://example.com/bangladesh-marketplaces',title:'Bangladesh e-commerce marketplaces'}]}),
    readSearchPage:async({url})=>{marketReads.push(url);return {status:'ok',source:'direct_page',url,title:'Bangladesh marketplaces',content:'Bangladesh marketplaces provide online shopping.'};},
  },()=>{},'top online marketplaces in Bangladesh');
  assert.deepEqual(marketReads,['https://example.com/bangladesh-marketplaces']);assert.equal(marketSources.length,1);
  const domain = fastResearchTaskFor('Check example.com official information', '', true);
  const redirected = await gatherFastResearch(domain, {
    searchWeb: async()=>({results:[{title:'Example',url:'https://example.com/policy'}]}),
    readSearchPage: async()=>({status:'ok',source:'direct_page',url:'https://other.example/policy',content:'Example official policy'}),
  },()=>{},'example com');
  assert.equal(redirected.length,0,'A domain query must not verify another host after redirect');
  const providerFailure = fastResearchTaskFor('Search company identity', '', true);
  await gatherFastResearch(providerFailure, {searchWeb:async()=>({status:'unavailable',message:'Provider blocked HTTP 202',results:[]}),readSearchPage:async()=>{throw Error('No page candidate');}},()=>{},'Example identity');
  assert.equal(providerFailure.searchFailures.length,3);
  assert.ok(providerFailure.searchFailures.every(failure=>failure.message==='Provider blocked HTTP 202'));
  assert.match(fastResearchContext(providerFailure),/Provider blocked HTTP 202/);
  const pageOnly = fastResearchTaskFor('Research whether this Uber page verifies Bangladesh safety policy. Do not search for other pages.');
  assert.equal(pageOnly.searchForbidden, true);
  pageOnly.answerText = 'The requested safety policy page is out of scope for Bangladesh. No Bangladesh policy was verified; the country-specific source is still missing.';
  assert.equal(fastResearchNeedsMore(pageOnly), false, 'A completed page rejection must not trigger a wider search');
  const task = fastResearchTaskFor('Research deeply OpenAI GPT and Google Gemini for voice, tools and coding.');
  assert.ok(task);
  let injected = false;
  const bridge = {
    searchWeb: async () => ({ status: 'ok', results: [] }),
    readSearchPage: async ({ url }) => {
      if (!injected && url === 'https://platform.openai.com/docs/models') {
        injected = true;
        return { status: 'unavailable', url, message: 'Simulated page failure for recovery check.' };
      }
      return { status: 'ok', source: 'direct_page', url, title: 'Official model page', content: 'Model capabilities and inputs.' };
    },
  };
  await gatherFastResearch(task, bridge, () => {});
  assert.equal(task.sources[0].status, 'verified');
  assert.equal(task.sources[0].url, 'https://developers.openai.com/api/docs/models');
  assert.equal(task.failedPages.length, 1);
  assert.match(task.failedPages[0], /Simulated page failure/);
  assert.doesNotMatch(task.failedPages[0], /redirect/);

  task.continuationCount = 1;
  task.answerText = 'OpenAI GPT and Google Gemini support image and audio inputs. For coding and voice, the model pages describe distinct use cases. Reasoning and tools vary by model. Limitations are not disclosed for every release.';
  task.answerChars = task.answerText.length;
  assert.deepEqual(missingFastResearchTopics(task), []);
  assert.equal(fastResearchNeedsMore(task), false);

  const incomplete = fastResearchTaskFor('Research deeply GPT and Gemini for live voice, tool calling, and coding.');
  incomplete.continuationCount = 1;
  incomplete.answerText = 'Both vendors offer image and audio models. For coding, model capabilities vary. Architectural details remain unverified.';
  incomplete.answerChars = incomplete.answerText.length;
  assert.ok(missingFastResearchTopics(incomplete).includes('live voice'));
  assert.ok(missingFastResearchTopics(incomplete).includes('tool calling'));
  assert.equal(fastResearchNeedsMore(incomplete), true);
  const general = fastResearchTaskFor('Research Fast profile accuracy and speed');
  for(const question of ['Find a reliable source explaining installed solar capacity versus electricity generated and cite it.','নির্ভরযোগ্য সূত্র পড়ে সৌরবিদ্যুতের ক্ষমতা আর উৎপাদনের পার্থক্য ব্যাখ্যা করো।']) {
    const ordinary=fastResearchTaskFor(question,'',true);
    assert.ok(!ordinary.requiredTopics.includes('accuracy and reliability'),'Source quality must not create a new explanatory outcome');
  }
  assert.ok(general.requiredTopics.includes('accuracy and reliability'),'An explicit request about profile accuracy remains required');
  assert.ok(missingFastResearchTopics(general).length>0,'Empty research answer must be rejected');
  general.answerText='This unrelated article discusses oceans and marine wildlife in considerable detail, including habitat, migration and feeding patterns.';
  assert.ok(missingFastResearchTopics(general).includes('answer the original question'));
  assert.ok(missingFastResearchTopics(general).includes('accuracy and reliability'));
  const company = fastResearchTaskFor('Research Daraz versus Pickaboo returns and warranty policies');
  const searches = [];
  const focused = {
    searchWeb: async ({ query }) => {
      searches.push(query);
      const brand = query.includes('Pickaboo') ? 'Pickaboo' : 'Daraz';
      return { results: [1, 2].map(i => ({ url: `https://${brand.toLowerCase()}${i}.example/policy` })) };
    },
    readSearchPage: async ({ url }) => ({ status: 'ok', source: 'direct_page', url, title: url.includes('pickaboo') ? 'Pickaboo warranty' : 'Daraz returns', content: 'Navigation.\n'.repeat(60) + 'Daraz returns: save the packaging and order receipt. Pickaboo warranty: proof of purchase is required.' }),
  };
  const returns = await gatherFastResearch(company, focused, () => {}, 'Daraz returns');
  const warranty = await gatherFastResearch(company, focused, () => {}, 'Pickaboo warranty');
  assert.ok(searches.includes('Daraz returns'));
  assert.ok(searches.includes('Pickaboo warranty'), 'Second query must execute rather than reuse first-query evidence');
  assert.ok(returns.every(source => source.url.includes('daraz')));
  assert.ok(warranty.every(source => source.url.includes('pickaboo')));
  assert.equal(company.sources.length, 4, 'Evidence from both requested companies must survive');
  assert.equal(fastResearchSourceId(company.sources[0]), company.sources[0].url);
  const originalId = fastResearchSourceId(company.sources[0]);
  company.sources.reverse();
  assert.equal(fastResearchSourceId(company.sources.find(source => source.url === originalId)), originalId, 'Citation identity must survive source reordering and later turns');
  const evidence = JSON.parse(fastResearchContext(company));
  assert.ok(evidence.sources.every(source => source.id === source.url));
  assert.match(company.sources[0].content, /save the packaging/, 'Business policy evidence after navigation must survive compaction');
  const count = searches.length;
  await gatherFastResearch(company, focused, () => {}, 'Pickaboo warranty');
  await gatherFastResearch(company, focused, () => {});
  assert.equal(searches.length, count, 'Repeated-query and continuation reuse must not issue noisy whole-prompt searches');
  const localPolicy = fastResearchTaskFor('Research Daraz Bangladesh delivery, returns, warranty, and customer support');
  const readUrls = [];
  await gatherFastResearch(localPolicy, {
    searchWeb: async () => ({ results: [{ url: 'https://www.daraz.pk/return-policy' }, { url: 'https://www.daraz.com.np/warranty-policy' }, { url: 'https://www.daraz.com.bd/return-policy' }] }),
    readSearchPage: async ({ url }) => { readUrls.push(url); return { status: 'ok', source: 'direct_page', url, title: 'Daraz policy', content: 'Daraz Bangladesh returns information.' }; },
  }, () => {}, 'Daraz Bangladesh returns');
  assert.deepEqual(readUrls, ['https://www.daraz.com.bd/return-policy']);
  assert.equal(localPolicy.sources.length, 1);
  assert.ok(localPolicy.failedPages.some(reason => /different country/.test(reason)));
  localPolicy.answerText = 'Daraz operates a marketplace with various sellers. Return requirements and the warranty must be checked for the specific product. The exact deadlines are not verified by the page.';
  assert.ok(missingFastResearchTopics(localPolicy).includes('delivery and coverage'));
  assert.ok(missingFastResearchTopics(localPolicy).includes('customer support'));
  const teaser = fastResearchTaskFor('Research Chaldal and Shwapno grocery options');
  teaser.answerText = "I'll research Chaldal and Shwapno. The initial sources did not verify the requested facts. I will need to try more targeted queries to provide a reliable comparison and shopping plan.";
  teaser.sources = [{ status: 'verified', url: 'https://example.com', title: 'Chaldal', publisher: 'Example' }];
  assert.ok(missingFastResearchTopics(teaser).some(topic => topic.includes('do not end with a promise')));
  assert.equal(fastResearchNeedsMore(teaser), true);
  const audit = fastResearchTaskFor('Research and audit our earlier return policy comparison', 'Research Daraz Bangladesh returns');
  assert.equal(audit.market, 'Bangladesh');
  assert.match(fastResearchScopeIssue(audit, 'https://daraz.pk/return-policy'), /different country/);
  assert.match(fastResearchScopeIssue(audit, 'https://www.uber.com/ca/en/legal/service-animal-policy/'), /different country/);
  assert.match(fastResearchScopeIssue(audit, 'https://www.uber.com/legal/ml/document?country=canada&lang=en&name=service-animal-policy'), /different country/);
  assert.equal(fastResearchScopeIssue(audit, 'https://help.uber.com/en-GB/riders/article/review-my-cancellation-fee'), undefined, 'Translation locale alone is not a country-specific policy');
  for (const region of ['gh', 'jm', 'hn']) assert.match(fastResearchScopeIssue(audit, `https://www.uber.com/${region}/en/ride/safety/audio-recording/`), /different country/);
  const international = fastResearchTaskFor('Research Daraz Bangladesh versus Pakistan return policies');
  assert.equal(fastResearchScopeIssue(international, 'https://daraz.pk/return-policy'), undefined, 'Explicit cross-country comparisons must still work');
  const transport = fastResearchTaskFor('বাংলায় উত্তর দাও। বাংলাদেশে Pathao আর Uber নিয়ে গবেষণা করো। পেমেন্ট ও বাতিলের নিয়ম নিয়ে অফিসিয়াল সূত্র ব্যবহার করো।');
  assert.deepEqual(transport.subjects, ['Pathao', 'Uber']);
  assert.match(fastResearchSourceIssue(transport, 'https://www.thedailystar.net/tech-startup/news/uber-working-resume-card-payment-services-bangladesh-3337436'), /secondary source/);
  assert.equal(fastResearchSourceIssue(transport, 'https://help.uber.com/en/riders/article/review-my-cancellation-fee'), undefined);
  transport.answerText = 'Pathao and Uber have several options. However, current coverage, payment, cancellation, safety and complaint details remain unverified from available reports.';
  transport.queries = ['Pathao Bangladesh'];
  assert.ok(missingFastResearchTopics(transport).some(topic => topic.includes('lookup for Uber')));
  assert.ok(missingFastResearchTopics(transport).some(topic => topic.includes("Pathao's official domain")));
  transport.queries.push('site:pathao.com ride services', 'site:uber.com Bangladesh safety');
  assert.ok(!missingFastResearchTopics(transport).some(topic => /official domain|lookup for/.test(topic)), 'A failed official lookup is an observed blocker, not an unattempted step');
  const rideEvidence = fastResearchTaskFor('Research Pathao versus Uber Bangladesh ride cancellation policy using official sources');
  await gatherFastResearch(rideEvidence, {
    searchWeb: async () => ({ results: [{ url: 'https://cyclingclub.example/ride-cancellation' }, { url: 'https://uber.com/bd/policy' }] }),
    readSearchPage: async ({ url }) => ({ status: 'ok', source: 'direct_page', url, title: 'Ride cancellation policy', content: url.includes('uber.com') ? 'Uber Bangladesh cancellation policy.' : 'Cycling club ride cancellation and safety rules.' }),
  }, () => {}, 'Uber Bangladesh ride cancellation policy');
  assert.deepEqual(rideEvidence.sources.map(source => source.url), ['https://uber.com/bd/policy'], 'A generic ride policy must not be presented as Uber evidence');
  console.log('Fast research recovery and coverage checks passed.');
  const known=fastResearchTaskFor('Research Florian BD published prices','',true);
  known.knownSources=[{url:'https://florianbd.com/',title:'Florian BD plant nursery',publisher:'florianbd.com',observedAt:Date.now()}];
  let indexedSearches=0;const rereads=[];
  await gatherFastResearch(known,{searchWeb:async()=>{indexedSearches++;return {results:[]};},readSearchPage:async({url})=>{rereads.push(url);return {status:'ok',source:'direct_page',url,title:'Florian BD plant nursery',content:'Florian BD offers plants with published product prices.'};}},()=>{},'Florian BD pricing');
  assert.equal(indexedSearches,0);assert.deepEqual(rereads,['https://florianbd.com/']);
  const scoped=fastResearchTaskFor('Research Florian BD published categories','',true);scoped.knownSources=known.knownSources;rereads.length=0;
  await gatherFastResearch(scoped,{searchWeb:async()=>{indexedSearches++;return {results:[]};},readSearchPage:async({url})=>{rereads.push(url);return {status:'ok',source:'direct_page',url,title:'Florian BD plant nursery',content:'Florian BD offers plants with published product categories in Bangladesh.'};}},()=>{},'site:florianbd.com plant categories');
  assert.equal(indexedSearches,0);assert.deepEqual(rereads,['https://florianbd.com/']);
  const official=fastResearchTaskFor('Read official Gemini Live API documentation https://ai.google.dev/gemini-api/docs/live-api/capabilities','',true);
  assert.match(fastResearchSourceIssue(official,'https://addonstudio.org/wiki/WoW:World_of_Warcraft_API'),/not an official source/);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
