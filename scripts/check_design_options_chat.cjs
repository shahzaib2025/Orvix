const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');

test('public design options survive completed-turn condensation and JSON storage', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/components/AgentDashboard.tsx'), 'utf8');
  const start = source.indexOf('function compactActivityText(');
  const end = source.indexOf('function boundTaskHistory(', start);
  assert.ok(start > 0 && end > start);
  const code = ts.transpileModule(`${source.slice(start, end)}\nmodule.exports = boundActivity;`, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const context = {module:{exports:{}}, MAX_SAVED_ACTIVITY_ITEMS:100, MAX_SAVED_TOOL_OUTPUT:8000, redactApiKeys:value=>value};
  vm.runInNewContext(code, context);
  const choices = {kind:'progress',id:'website-design-options',category:'agent_update',status:'completed',text:'Option A: '+ 'a'.repeat(6400)+'\nOption B: '+ 'b'.repeat(6400)+'\nSelection reason: stronger hierarchy.'};
  const activity = [choices, ...Array.from({length:50}, (_,i)=>`Tool note ${i}`)];
  const saved = JSON.parse(JSON.stringify(context.module.exports(activity, 24, 600)));
  assert.equal(saved.length,24);
  assert.equal(saved.find(item=>item.id===choices.id)?.text,choices.text);
  assert.equal(context.module.exports(undefined),undefined);
});

test('chat renders both options outside collapsed work and thinking groups', () => {
  const {buildSync} = require('esbuild');
  const React = require('react');
  const {renderToStaticMarkup} = require('react-dom/server');
  const bundled = buildSync({entryPoints:[path.join(__dirname,'../src/components/AgentActivityTimeline.tsx')],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',jsx:'automatic',loader:{'.css':'empty'}});
  const context={module:{exports:{}},exports:{},require,console,process,Buffer,setTimeout,clearTimeout};
  context.exports=context.module.exports;
  vm.runInNewContext(bundled.outputFiles[0].text,context);
  const text='Design options and selection\n\nSELECTED — Option A, "Blast Column".\n\nFirst viewport: full-bleed black field with a large subject illustration and compact chapter rail.\n\nSection plan: the selected page develops the subject across eleven sections before the alternatives are summarized.\n\nOption A — Blast Column: one continuous vertical composition carries the subject through the page, with scroll progression tied to its changing state.\nOption B — Dossier Archive: a typographic archive presents the subject as a sequence of framed evidence plates, with in-page transitions and no pinned scenes.\nSelection reason: Option A gives the subject a continuous presence while Option B favors archival reading.\n\nSelected direction can proceed. Originality comparison was unavailable; uniqueness is not verified.';
  const html=renderToStaticMarkup(React.createElement(context.module.exports.AgentActivityTimeline,{pending:false,items:[
    {kind:'tool',id:'brief-tool',name:'set_design_brief',detail:'Record options',status:'completed',startedAt:1},
    {kind:'progress',id:'website-design-options',category:'agent_update',text,status:'completed',startedAt:2,providerId:'provider',providerLabel:'Provider',modelId:''},
    {kind:'tool',id:'write-tool',name:'write',detail:'index.html',status:'completed',startedAt:3},
  ]}));
  assert.match(html,/Expanded option record/);
  assert.match(html,/eleven sections before the alternatives are summarized/);
  assert.match(html,/aria-label="Design options and selection"/);
  assert.match(html,/aria-label="Preview Option A/);
  assert.match(html,/aria-label="Preview Option B/);
  assert.match(html,/Selection reason/);
  assert.match(html,/agent-design-options-grid/);
  assert.doesNotMatch(html,/aria-label="Thinking from Provider"/);
  const output=path.join(__dirname,'../scratch/design-options-cards.html');
  const css=fs.readFileSync(path.join(__dirname,'../src/components/agent-workspace.css'),'utf8');
  fs.writeFileSync(output,`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#181919;font-family:Arial,sans-serif;margin:24px}main{max-width:820px;margin:auto}${css}</style><main>${html}</main>`);
});

test('option parsing supports reversed order and keeps unstructured historical briefs intact', () => {
  const {buildSync}=require('esbuild');
  const bundled=buildSync({entryPoints:[path.join(__dirname,'../src/components/designOptionsPresentation.ts')],bundle:true,write:false,platform:'node',format:'cjs'});
  const context={module:{exports:{}},exports:{}};context.exports=context.module.exports;
  vm.runInNewContext(bundled.outputFiles[0].text,context);
  const parse=context.module.exports.designOptionsPresentation;
  const result=parse('SELECTED — Option B: product fills the screen.\nOption A — not for construction: editorial split.\nSelection reason: clear product focus.\n\nRevision needed before building. This proposal is not cleared for construction.');
  assert.equal(result.selected,'B');
  assert.equal(result.options[0].label,'A');assert.equal(result.options[1].label,'B');
  assert.equal(result.reason,'clear product focus.');
  assert.match(result.status,/Revision needed/);
  assert.equal(parse('Chosen composition, no separately recorded alternatives.'),null);
  assert.equal(parse('Option A: hero only, other option missing.'),null);

  const legacyComparison=parse([
    'Option A: A media-led composition foregrounds the product.',
    'Option B: A typographic composition foregrounds the product story.',
    'Structural & Conceptual Difference: A uses product evidence first; B leads with the visitor problem.',
    'Selected option: B',
    'Selection reason: B explains the product value before asking visitors to explore it.'
  ].join('\n'));
  assert.ok(legacyComparison);
  assert.doesNotMatch(legacyComparison.options[1].body,/Structural & Conceptual Difference/,'legacy comparison prose must not leak into Option B');
  assert.match(legacyComparison.reason,/Structural difference: A uses product evidence first; B leads with the visitor problem\./,'the comparison remains visible alongside the selection reason');
});

test('long selected blueprint still publishes two card-ready options from its later A/B summaries', async () => {
  const { createDesignReview } = require('../electron/agent/design-review.cjs');
  const { buildSync } = require('esbuild');
  const events=[];
  const review=createDesignReview({enabled:true,profile:'max',mode:'off',brief:'Create a new website about Godzilla.',
    evidence:{record:()=>({id:'options-evidence'})},emit:event=>events.push(event),signal:new AbortController().signal});
  const storyboard=[
    'SELECTED — Option A, "Blast Column".',
    'First viewport: full-bleed black field, the subject fills the right side and the title occupies the left.',
    'Section plan: the detailed selected blueprint contains eleven sections before the two alternatives.',
    'Option A — Blast Column: one continuous vertical composition ties the subject to page progression.',
    'Option B — Dossier Archive: a typographic archive presents the subject through framed evidence plates.',
    'Selection reason: Option A gives the subject a continuous presence; Option B favors archival reading.'
  ].join('\n');
  await review.setBrief({audience:'Film fans',primary_action:'Explore the exhibit',direction:'A cinematic subject-led exhibit',signature:'One evolving subject',responsive:'Stack the title and subject on mobile',storyboard});
  const update=events.find(event=>event.progressId==='website-design-options');
  assert.ok(update);
  const bundled=buildSync({entryPoints:[path.join(__dirname,'../src/components/designOptionsPresentation.ts')],bundle:true,write:false,platform:'node',format:'cjs'});
  const context={module:{exports:{}},exports:{}};context.exports=context.module.exports;
  vm.runInNewContext(bundled.outputFiles[0].text,context);
  const presentation=context.module.exports.designOptionsPresentation(update.text);
  assert.ok(presentation,'published update must be parsed as comparison cards');
  assert.equal(presentation.selected,'A');
  assert.match(presentation.options[0].body,/continuous vertical composition/);
  assert.match(presentation.options[1].body,/framed evidence plates/);
});
