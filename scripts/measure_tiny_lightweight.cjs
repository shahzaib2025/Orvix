// Disposable, local-only measurements. No providers, permission changes or OS actions.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),Module=require('node:module');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),baseline=path.join(root,'scratch','tiny-lightweight-baseline-20261021');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function load(name,before){
  const filename=path.join(root,'electron',name);
  if(!before)return require(filename);
  const mod=new Module(filename,module);mod.filename=filename;mod.paths=Module._nodeModulePaths(path.dirname(filename));
  mod._compile(fs.readFileSync(path.join(baseline,'electron',name),'utf8'),filename);return mod.exports;
}
async function child(mode,before){
  if(mode==='adapter'){
    global.gc?.();const initial=process.memoryUsage(),start=performance.now();load('tiny-workflow-adapters.cjs',before);const loadMs=performance.now()-start;global.gc?.();const end=process.memoryUsage();
    return {runtime:process.versions,loadMs,retainedHeapMiB:(end.heapUsed-initial.heapUsed)/1048576,rssDeltaMiB:(end.rss-initial.rss)/1048576,modules:Object.keys(require.cache).length};
  }
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'orvix-light-measure-'));
  let cpuProbes=0,memoryProbes=0,folderScans=0,timerCallbacks=0;
  const cpus=os.cpus,freemem=os.freemem,readdir=fs.promises.readdir,interval=global.setInterval;
  os.cpus=(...args)=>{cpuProbes++;return cpus(...args);};os.freemem=(...args)=>{memoryProbes++;return freemem(...args);};
  fs.promises.readdir=(...args)=>{folderScans++;return readdir(...args);};
  global.setInterval=(callback,ms,...args)=>interval(()=>{timerCallbacks++;callback(...args);},ms);
  let engine,cpu,start;const setup=performance.now();
  try{
    if(mode==='folder'){
      fs.writeFileSync(path.join(directory,'baseline.txt'),'fixture');
      engine=load('tiny-agent-sensors.cjs',before).createTinyAgentSensors({listRules:()=>[{enabled:true,condition:{op:'predicate',signal:'folder_new_file',comparator:'contains',value:'.txt',target:directory}}],onUpdate:()=>{}});
      await engine.start();cpu=process.cpuUsage();start=performance.now();await sleep(12500);
    }else{
      engine=load('tiny-agents.cjs',before).createTinyAgents({getPath:()=>directory},{});engine.start();engine.setVoiceActive(true);cpu=process.cpuUsage();start=performance.now();await sleep(1250);
    }
    const durationMs=performance.now()-start,usage=process.cpuUsage(cpu);
    return {durationMs,setupMs:start-setup,cpuMs:(usage.user+usage.system)/1000,cpuProbes,memoryProbes,folderScans,timerCallbacks,...(engine.diagnostics?{diagnostics:engine.diagnostics()}:{}),runtime:process.versions};
  }finally{engine?.stop();fs.rmSync(directory,{recursive:true,force:true});}
}
function run(mode,before){return new Promise((resolve,reject)=>{
  const binary=process.env.ORVIX_MEASURE_ELECTRON==='1'?path.join(root,'node_modules','electron','dist','electron.exe'):process.execPath;
  const processChild=spawn(binary,['--expose-gc',__filename,'--child',mode,before?'before':'after'],{cwd:root,windowsHide:true,env:{...process.env,...(process.env.ORVIX_MEASURE_ELECTRON==='1'?{ELECTRON_RUN_AS_NODE:'1'}:{})}});
  let output='',error='';processChild.stdout.on('data',bytes=>output+=bytes);processChild.stderr.on('data',bytes=>error+=bytes);processChild.on('error',reject);
  processChild.on('exit',code=>{if(code!==0)return reject(Error(error||output));try{resolve(JSON.parse(output));}catch{reject(Error(output+'\n'+error));}});
});}
if(process.argv[2]==='--child')void child(process.argv[3],process.argv[4]==='before').then(value=>console.log(JSON.stringify(value))).catch(error=>{console.error(error);process.exitCode=1;});
else void(async()=>{
  const report={measuredAt:new Date().toISOString(),scope:'Isolated disposable fixtures and fresh module loads, not whole-app RAM savings.',adapter:{before:[],after:[]},folder:{},idleVoice:{}};
  for(let index=0;index<3;index++)for(const before of [true,false])report.adapter[before?'before':'after'].push(await run('adapter',before));
  for(const [mode,key]of [['folder','folder'],['idle','idleVoice']])for(const before of [true,false])report[key][before?'before':'after']=await run(mode,before);
  const file=path.join(root,'scratch','tiny-lightweight-measurements.json');fs.writeFileSync(file,JSON.stringify(report,null,2));
  const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
  console.log(JSON.stringify({file,adapter:Object.fromEntries(['before','after'].map(key=>[key,Object.fromEntries(['loadMs','retainedHeapMiB','rssDeltaMiB','modules'].map(field=>[field,median(report.adapter[key].map(value=>value[field]))]))])),folder:report.folder,idleVoice:report.idleVoice},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
