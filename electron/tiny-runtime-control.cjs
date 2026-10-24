const fs=require('node:fs'),path=require('node:path');
function createRuntimeControl(directory,agents,workflows,changed) {
    const file=path.join(directory,'tiny-runtime-control.json');
    let saved={version:1,status:'stopped',backgroundEnabled:false,monitors:[],definitions:[],runs:[]},stopping;
    for(const target of [file,file+'.bak']) {try {const value=JSON.parse(fs.readFileSync(target,'utf8'));if(value.version!==1||!Array.isArray(value.monitors)||!Array.isArray(value.runs)||!Array.isArray(value.definitions))throw Error();saved=value;break;}catch{}}
    function persist() {const write=target=>{const fd=fs.openSync(target,'w');try{fs.writeFileSync(fd,JSON.stringify(saved));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};write(file+'.tmp');if(fs.existsSync(file))fs.copyFileSync(file,file+'.bak');fs.renameSync(file+'.tmp',file);changed({...saved});}
    function capture(reason) {
        const monitors=agents.list().rules.filter(rule=>rule.enabled&&!rule.draft).map(rule=>rule.id);
        const listing=workflows.list(),definitions=listing.definitions.filter(def=>def.enabled).map(def=>({id:def.id,revision:def.approvedRevision})),runs=listing.runs.filter(run=>['running','waiting','queued','needs_attention'].includes(run.status)).map(run=>run.id);
        saved={...saved,status:'stopping',reason,monitors:[...new Set([...saved.monitors,...monitors])],definitions:[...new Map([...saved.definitions,...definitions].map(value=>[value.id,value])).values()],runs:[...new Set([...saved.runs,...runs])]};
        // Save stop intent and restart candidates before disabling any engine.
        persist();agents.pauseAll();workflows.pauseAll(reason);
    }
    function stop(reason='Stopped by you.') {
        if(stopping)return stopping;
        capture(reason);
        return stopping=(async()=>{try{await Promise.all([agents.waitForActions(),workflows.waitForIdle()]);saved.status='stopped';saved.stoppedAt=Date.now();persist();return {...saved};}finally{stopping=null;}})();
    }
    async function manage(input) {
        if(input.action==='stop')return stop();
        if(input.action==='background') {if(typeof input.enabled!=='boolean')throw Error('Choose an explicit background setting.');saved.backgroundEnabled=input.enabled;persist();return {...saved};}
        if(input.action!=='start')throw Error('Choose Start or Stop all.');
        if(stopping||saved.status==='stopping')throw Error('Execution is still stopping. Wait for acknowledgement.');
        saved.status='running';saved.startedAt=Date.now();persist();
        for(const id of saved.monitors){const rule=agents.list().rules.find(rule=>rule.id===id);if(rule&&!rule.draft)agents.setEnabled(id,true);}
        const result=workflows.resumeSaved(saved);saved={...saved,monitors:[],definitions:[],runs:result.blocked};persist();return {...saved,blocked:result.blocked};
    }
    function forget(engine,method,args) {
        const before=JSON.stringify([saved.monitors,saved.definitions,saved.runs]);
        if(engine==='agents'&&['remove','setEnabled'].includes(method)&&args[1]!==true)saved.monitors=saved.monitors.filter(id=>id!==args[0]);
        if(engine==='workflows'&&method==='manage'&&['cancel','pause'].includes(args[0]?.action))saved.runs=saved.runs.filter(id=>id!==args[0].runId);
        if(engine==='workflows'&&method==='manage'&&args[0]?.action==='disable')saved.definitions=saved.definitions.filter(value=>value.id!==args[0].id);
        if(before!==JSON.stringify([saved.monitors,saved.definitions,saved.runs]))persist();
    }
    return {manage,stop,forget,initialize:()=>stop('Orvix opened. Start reviewed agents explicitly when ready.'),state:()=>({...saved}),allows:(engine,method,args)=>saved.status==='running'||!(engine==='agents'&&(method==='approve'||method==='setEnabled'&&args[1])||engine==='workflows'&&method==='manage'&&['approve','start','enable','resume','retry','update_run','answer'].includes(args[0]?.action))};
}
module.exports={createRuntimeControl};
