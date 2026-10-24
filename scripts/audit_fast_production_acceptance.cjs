// Summarize final targeted Live checks without rewriting diagnostic runs.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),Module=require('node:module');
const load=file=>JSON.parse(fs.readFileSync(path.join(__dirname,file),'utf8'));
const delivery=load('check_fast_long_conversation.production-delivery.report.json');
const weather=load('check_fast_long_conversation.production-weather.report.json');
const built=require('esbuild').buildSync({entryPoints:[path.join(__dirname,'../src/fastTask.ts')],bundle:true,platform:'node',format:'cjs',write:false,logLevel:'silent'});
const moduleLoaded=new Module(__filename,module);moduleLoaded.paths=module.paths;moduleLoaded._compile(built.outputFiles[0].text,__filename);
const selected=[{report:'production-delivery',turn:delivery.turns.find(turn=>turn.number===2)},{report:'production-weather',turn:weather.turns.find(turn=>turn.number===4)},{report:'production-delivery',turn:delivery.turns.find(turn=>turn.number===6)}];
for(const {turn} of selected){assert.equal(turn.status,'completed');assert.deepEqual(turn.findings,[]);assert.ok(turn.toolCalls.length);assert.ok(turn.playedAudioChunks);}
assert.ok(moduleLoaded.exports.weatherAnswerCoversCities(selected[1].turn.answer),'Latest city-coverage guard must accept the live reply');
assert.equal(selected[1].turn.weather.length,8);
assert.equal(selected[2].turn.searches.length,0);
const result={status:'passed',generatedAt:new Date().toISOString(),scope:'Final targeted real Gemini Live checks across sessions with restored diagnostic chat history. Typed requests, real public tools, counted PCM; no microphone or audible playback. Does not certify all research claims or the entire product.',checks:selected.map(({report,turn})=>({report,turn:turn.number,modelToolCalls:turn.toolCalls.length,searches:turn.searches.length,pages:turn.pages.length,weatherLookups:turn.weather.length,firstAudioMs:turn.firstAudioMs,elapsedMs:turn.elapsedMs,admittedAudioChunks:turn.playedAudioChunks,findings:turn.findings,answer:turn.answer}))};
fs.writeFileSync(path.join(__dirname,'check_fast_production_acceptance.report.json'),JSON.stringify(result,null,2));console.log('Final targeted production acceptance: passed');
