// Build-time preparation only; contains generic action speech, never user data.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const root=path.join(__dirname,'..');require('../electron/live-env.cjs').loadLiveEnv(root);
global.window={orvixDesktop:{createLiveToken:require('../electron/live-auth.cjs').createLiveToken}};
function load(file){const m=new Module(__filename,module);m.paths=module.paths;m._compile(require('esbuild').buildSync({entryPoints:[path.join(root,'src',file)],bundle:true,platform:'node',format:'cjs',write:false,logLevel:'silent'}).outputFiles[0].text,__filename);return m.exports;}
const {FastProgressVoice,validProgress}=load('fastProgressVoice.ts');
const {toolAcknowledgment}=load('fastToolAcknowledgment.ts');
const {FastNarrator}=load('fastNarrator.ts');
const {divisionWeatherLocations,weatherLocation}=load('fastWeather.ts');
const file=path.join(root,'src/fastAckClips.json');
const bank=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};
const operations=[{name:'web_search'},{name:'read_web_page'},{name:'browser_observe'},...['search','pause','play','select','open','minimize','maximize','restore','focus','close','click','scroll'].map(action=>({name:['minimize','maximize','restore','focus'].includes(action)?'manage_window':'browser_act',action})),{name:'list_directory'},{name:'read_file'},{name:'write_file'},{name:'get_weather'},{name:'unknown'}];
const weatherOperations=divisionWeatherLocations.map(place=>({name:'get_weather',subject:place.query}));
const selected=process.argv.includes('--weather')?weatherOperations:[...operations,...weatherOperations];
const jobs=['bn','en'].flatMap(language=>[...selected.map(operation=>({stage:'tool',goal:'Describe only the next action',operation})),...(process.argv.includes('--weather')?[]:[{stage:'tool',goal:'Retry the failed window action',recovery:'window_retry',operation:{name:'manage_window',action:'minimize'}}])].map(context=>({language,context,key:toolAcknowledgment(context,language)}))).filter(j=>!bank[j.key]||j.context.operation.subject&&weatherLocation(bank[j.key].text)?.key!==weatherLocation(j.context.operation.subject)?.key);
let index=0,failures=0;
async function worker(){
  const v=new FastProgressVoice(),n=new FastNarrator();
  try {
    while(index<jobs.length){
      const j=jobs[index++];let done=false;
      for(let attempt=0;attempt<3&&!done;attempt++)try{
        const r=attempt===0?{text:j.key,audio:await n.render(j.key,j.language,new AbortController().signal,{retry:false,timeoutMs:12000})}
          :await v.generate({...j.context,acceptCompleteLength:true},j.language,new AbortController().signal,12000);
        if(!validProgress(r.text)||!r.audio.length)throw Error('Invalid clip');
        const place=weatherLocation(j.context.operation.subject||'');
        if(place&&weatherLocation(r.text)?.key!==place.key)throw Error('Weather clip omitted its city');
        if(place&&r.text.trim().split(/\s+/).length>6)throw Error('Weather clip exceeds six words');
        const pcm=Buffer.concat(r.audio.map(c=>Buffer.from(c,'base64')));let first=0,last=pcm.length;
        while(first+1<last&&Math.abs(pcm.readInt16LE(first))<=33)first+=2;
        while(last>first+2&&Math.abs(pcm.readInt16LE(last-2))<=33)last-=2;
        if(last-first<2400)throw Error('Silent clip');
        bank[j.key]={text:r.text,audio:[pcm.subarray(Math.max(0,first-480),Math.min(pcm.length,last+480)).toString('base64')]};
        fs.writeFileSync(file,JSON.stringify(bank));console.log(j.language,j.context.operation.name,j.context.operation.action||'',r.text);done=true;
      }catch(e){v.close();n.close();console.log('retry',j.language,j.context.operation.name,e.message);}
      if(!done)failures++;
    }
  }finally{v.close();n.close();}
}
Promise.all([worker(),worker(),worker()]).then(()=>{console.log('Prepared',Object.keys(bank).length,'clips; failures',failures);if(failures)process.exitCode=1;});
