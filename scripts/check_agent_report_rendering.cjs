const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),Module=require('node:module');
const esbuild=require('esbuild'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
function load(file){
 const code=esbuild.buildSync({entryPoints:[path.resolve(file)],bundle:true,platform:'node',format:'cjs',jsx:'automatic',write:false,loader:{'.css':'empty'},external:['react','react/jsx-runtime','lucide-react']}).outputFiles[0].text;
 const loaded=new Module(path.resolve('report-test-fixture.cjs'),module);loaded.filename=loaded.id;loaded.paths=module.paths;loaded._compile(code,loaded.filename);return loaded.exports;
}
const {parseAgentReport,splitTableRow}=load('src/components/agentReportParser.ts');
const Report=load('src/components/AgentReport.tsx').default;
const render=(text,keyCheck=false)=>renderToStaticMarkup(React.createElement(Report,{text,keyCheck}));
test('section ranges include nested headings and stop at equal or higher headings',()=>{
 const text='Intro\n\n# Report\nBody\n\n## Validation\n- Passed\n\n### Detail\nNested\n\n## Limits\nUnknown\n\n# Next\nDone';
 const h=parseAgentReport(text).filter(b=>b.kind==='heading');
 assert.equal(text.slice(h[0].start,h[0].sectionEnd),text.slice(text.indexOf('# Report'),text.indexOf('# Next')));
 assert.equal(text.slice(h[1].start,h[1].sectionEnd),'## Validation\n- Passed\n\n### Detail\nNested\n\n');
 assert.equal(text.slice(h[2].start,h[2].sectionEnd),'### Detail\nNested\n\n');
 assert.equal(text.slice(h[4].start,h[4].sectionEnd),'# Next\nDone');
});
test('duplicate names use independent source offsets',()=>{
 const text='## Same\nFirst\n\n## Same\nSecond';const h=parseAgentReport(text).filter(b=>b.kind==='heading');
 assert.equal(text.slice(h[0].start,h[0].sectionEnd),'## Same\nFirst\n\n');assert.equal(text.slice(h[1].start,h[1].sectionEnd),'## Same\nSecond');
});
test('Unicode, CRLF, trailing whitespace and table boundaries remain exact',()=>{
 const text='আগে 😀\r\n\r\n## Résumé\r\n- বাংলা  \r\n\r\n| A | B |\r\n| --- | ---: |\r\n| 雪 | ✅ |\r\n\r\n## শেষ\r\n';
 const blocks=parseAgentReport(text),h=blocks.find(b=>b.kind==='heading'),t=blocks.find(b=>b.kind==='table');
 assert.equal(text.slice(h.start,h.sectionEnd),text.slice(text.indexOf('## Résumé'),text.indexOf('## শেষ')));
 assert.equal(text.slice(t.start,t.end),'| A | B |\r\n| --- | ---: |\r\n| 雪 | ✅ |\r\n');
});
test('code ranges retain indentation, CRLF and final interior newline',()=>{
 const text='## Example\r\n````js\r\n  const x = 1;\r\n\treturn x;\r\n```\r\n````\r\n## End';const b=parseAgentReport(text).find(b=>b.kind==='code');
 assert.equal(text.slice(b.codeStart,b.codeEnd),'  const x = 1;\r\n\treturn x;\r\n```\r\n');assert.equal(b.language,'js');
});
test('unfinished, tilde and empty fences need no invented closing fence',()=>{
 for(const [text,expected]of [['```js\n  hi\n\n','  hi\n\n'],['```',''],['~~~css\r\n\t.a{}','\t.a{}'],['```\n```\n','']]){
  const b=parseAgentReport(text)[0];assert.equal(b.kind,'code');assert.equal(text.slice(b.codeStart,b.codeEnd),expected);
 }
});
test('headings in code do not end sections; C# and six heading levels survive',()=>{
 const text='## Code\n```md\n## Fake\n```\nBody\n## Real\nEnd';const h=parseAgentReport(text).filter(b=>b.kind==='heading');
 assert.equal(h.length,2);assert.equal(h[0].sectionEnd,text.indexOf('## Real'));
 assert.deepEqual(parseAgentReport('# C#\n## B ##\n### C\n#### D\n##### E\n###### F').map(x=>x.title),['C#','B','C','D','E','F']);
});
test('escaped pipes, inline-code pipes, backslash parity and empty cells',()=>{
 assert.deepEqual(splitTableRow('| **A** | `b|c` | d\\|e | |'),['**A**','`b|c`','d\\|e','']);
 assert.deepEqual(splitTableRow('a\\\\| b | c'),['a\\\\','b','c']);
 assert.deepEqual(splitTableRow('| | |'),['','']);assert.deepEqual(splitTableRow('a | b'),['a','b']);
});
test('short and extra body cells survive and Markdown alignment renders',()=>{
 const text='| A | B | C |\n| :--- | :---: | ---: |\n| a | b |\n| x | y | z | extra |';const b=parseAgentReport(text)[0];
 assert.equal(b.kind,'table');assert.equal(b.columns,4);assert.deepEqual(b.alignments,['left','center','right']);assert.deepEqual(b.rows,[['a','b'],['x','y','z','extra']]);
 const html=render(text);assert.match(html,/>extra<\/td>/);assert.match(html,/text-align:center/);assert.match(html,/text-align:right/);
});
test('incomplete and mismatched dividers stay readable text',()=>{
 for(const text of ['| A | B |\n| --- |','| A | B |\n| -- | --- |\n| x | y |','| A | B |','a\\|b\n| --- | --- |']){
  assert.ok(!parseAgentReport(text).some(b=>b.kind==='table'));assert.doesNotMatch(render(text),/<table>/);
 }
});
test('inline formatting renders safely without model HTML or unsafe links',()=>{
 const html=render('## Safe\n\n| **Option** | Notes |\n| --- | --- |\n| `a\\|b` | [Docs](https://example.com) |\n| <script>window.pwned=1</script> | [bad](javascript:alert(1)) |');
 assert.match(html,/<strong>Option<\/strong>/);assert.match(html,/<code>/);assert.match(html,/rel="noopener noreferrer"/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script|href="javascript:/);
});
test('copy controls belong only to headings, tables and code, outside table scrolling',()=>{
 const html=render('## Main\n\nParagraph\n\n- Item\n\n| A | B |\n| --- | --- |\n| x | y |\n\n```js\nhi\n```');
 assert.equal((html.match(/<button /g)||[]).length,3);assert.match(html,/aria-label="Copy section: Main"/);assert.match(html,/aria-label="Copy table"/);assert.match(html,/aria-label="Copy code"/);
 assert.ok(html.indexOf('agent-report-table-toolbar')<html.indexOf('agent-report-table-wrap'));
});
test('restored historical replies need no migration',()=>{
 const saved={reply:'# Saved\r\n\r\n| Key | Value |\r\n| --- | --- |\r\n| old | unchanged |\r\n'};
 const restored=JSON.parse(JSON.stringify(saved));assert.equal(restored.reply,saved.reply);assert.match(render(restored.reply),/>unchanged<\/td>/);
});
test('specialized API-access reports retain their existing presentation',()=>{
 assert.match(render("Zen free-model access through Orvix's direct API:\n- Model: available\n\nNote",true),/OpenCode Zen access report/);
 const html=render('Provider: key accepted\n\n## Detail\nActual observation',true);assert.match(html,/Authentication confirmed/);assert.match(html,/Copy section: Detail/);
});
