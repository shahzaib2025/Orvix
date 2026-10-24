const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {reportStyleGuidance}=require('../electron/agent/response-format-guidance.cjs');
const {instructionsFor,requestBody}=require('../electron/agent/model-client.cjs');
const {designExecutionInstructions}=require('../electron/agent/design-review.cjs');
test('Chat, Responses and Messages executor prompts share report and comparison-table guidance',()=>{
 for(const route of ['chat','responses','messages']){
  const body=requestBody({id:'fixture',name:'Fixture',route},[{role:'user',content:'Compare the useful options and report actual checks.'}],[],null,()=>'',false,false,null,'Full access',null,'none');
  const prompt=route==='chat'?body.messages[0].content:route==='messages'?body.system:body.instructions;
  assert.ok(prompt.includes(reportStyleGuidance));
 }
 for(const purpose of ['conversation','request_understanding','acceptance_planning','check_review','completion_review','design_review','design_originality'])assert.ok(!instructionsFor(null,'Plan',purpose).includes(reportStyleGuidance));
});
test('native shared report guidance remains within the bounded system-prompt allowance',()=>{
 const fs=require('node:fs');
 const source=fs.readFileSync(path.resolve('electron/agent/opencode-agent.cjs'),'utf8');
 assert.match(source,/systemPrompt = \[nativeProgressGuidance, reportStyleGuidance, sizeReportingGuidance/);
 for(const profile of ['none','normal','medium','max'])assert.ok(reportStyleGuidance.length+designExecutionInstructions('Create a complete premium website.','Full access',profile).length+1000<8000);
});
test('existing AgentReport renders comparison tables, selective bold and bulleted reports as semantic elements',()=>{
 const esbuild=require('esbuild'),Module=require('node:module'),React=require('react');
 const {renderToStaticMarkup}=require('react-dom/server');
 const compiled=esbuild.buildSync({entryPoints:[path.resolve('src/components/AgentReport.tsx')],bundle:true,platform:'node',format:'cjs',jsx:'automatic',write:false,loader:{'.css':'empty'},external:['react','react/jsx-runtime','lucide-react']}).outputFiles[0].text;
 const loaded=new Module(path.resolve('agent-report-render-fixture.cjs'),module);loaded.filename=loaded.id;loaded.paths=module.paths;loaded._compile(compiled,loaded.filename);
 const sample='Implemented automatic skill selection.\n\nValidation:\n\n- **23 focused checks passed.**\n- Live validation remains separate.\n\n| Skill | What it improves |\n| --- | --- |\n| **Bug repair** | Trace the actual cause |\n| Browser verification | Check the primary interaction |\n\nUnobserved behavior remains unverified.';
 const html=renderToStaticMarkup(React.createElement(loaded.exports.default,{text:sample}));
 assert.match(html,/<table>/);assert.match(html,/<th scope="col">Skill<\/th>/);assert.match(html,/<strong>Bug repair<\/strong>/);assert.match(html,/<ul>/);assert.match(html,/<strong>23 focused checks passed\.<\/strong>/);
 assert.match(html,/agent-report-table-wrap/);assert.doesNotMatch(html,/<pre>/);
});
