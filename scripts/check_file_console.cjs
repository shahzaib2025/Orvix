const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
test('test logging survives closed output pipes and retains errors in its file',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'orvix-file-console-'));
 try {
  const file=path.join(root,'runner.log');
  const script=`const log=require(${JSON.stringify(path.join(__dirname,'file-console.cjs'))}).installFileConsole(${JSON.stringify(file)}); process.stdout.emit('error',Object.assign(new Error('closed pipe'),{code:'EPIPE'})); process.stderr.emit('error',Object.assign(new Error('destroyed pipe'),{code:'ERR_STREAM_DESTROYED'})); console.log('tool completed'); console.error('provider failed honestly'); log.end();`;
  const result=spawnSync(process.execPath,['-e',script],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'');assert.equal(result.stderr,'');
  const text=fs.readFileSync(file,'utf8');assert.match(text,/tool completed/);assert.match(text,/provider failed honestly/);
 } finally {fs.rmSync(root,{recursive:true,force:true});}
});
